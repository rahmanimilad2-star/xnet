package com.milad.vpn.vpn

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.VpnService
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.milad.vpn.R
import com.milad.vpn.data.ApiException
import com.milad.vpn.data.Repository
import com.milad.vpn.data.VpnConfig
import com.milad.vpn.ui.MainActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * Real VPN: Android VpnService creates the TUN interface, Xray-core (libv2ray) reads/writes the
 * packets and tunnels them through the configured outbound. Handles failover between servers,
 * network changes, periodic config/subscription sync and live speed stats.
 */
class AppVpnService : VpnService() {

    companion object {
        private const val TAG = "AppVpnService"
        const val ACTION_START = "com.milad.vpn.START"
        const val ACTION_STOP = "com.milad.vpn.STOP"
        const val ACTION_RELOAD = "com.milad.vpn.RELOAD"
        private const val CHANNEL = "vpn_status"
        private const val NOTIF_ID = 1
        private const val ACCOUNT_CHECK_MS = 60_000L
        private const val MAX_DELAY_MS = 6_000L
        /** Explicit "service denied" answers from our backend; everything else is treated as transient. */
        private val DENIAL_CODES = setOf("BLOCKED", "EXPIRED", "QUOTA_EXCEEDED", "NO_CONFIG")

        fun start(ctx: Context) = send(ctx, ACTION_START)
        fun stop(ctx: Context) = send(ctx, ACTION_STOP)
        fun reload(ctx: Context) = send(ctx, ACTION_RELOAD)
        private fun send(ctx: Context, action: String) {
            val i = Intent(ctx, AppVpnService::class.java).setAction(action)
            if (action == ACTION_START) ctx.startForegroundService(i) else ctx.startService(i)
        }
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var tun: ParcelFileDescriptor? = null
    private var connectJob: Job? = null
    private var monitorJob: Job? = null
    private var current: VpnConfig? = null
    @Volatile private var networkCallback: ConnectivityManager.NetworkCallback? = null
    @Volatile private var currentUnderlyingNetwork: Network? = null
    private var lostNetwork = false
    private var lifecycleGeneration = 0L
    private var reconnectJob: Job? = null
    private val lifecycleLock = Any()
    private val coreLock = Any()
    /** Guarded by coreLock. Identifies which connect generation owns the currently started core/TUN. */
    private var activeCoreGeneration: Long? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> { shutdown(null, null); return START_NOT_STICKY }
            ACTION_RELOAD -> {
                if (VpnState.status.value.phase != Phase.DISCONNECTED) {
                    registerNetworkCallback()
                    connect(Repository.configsToTry(), reconnect = true)
                } else {
                    invalidatePendingWork()
                }
                return START_STICKY
            }
            else -> {
                try {
                    startAsForeground("در حال اتصال…")
                    registerNetworkCallback()
                    connect(Repository.configsToTry())
                } catch (e: Exception) {
                    Log.e(TAG, "VPN service startup failed", e)
                    shutdown(
                        "خطا در راه‌اندازی سرویس VPN: ${e.message ?: "نامشخص"}",
                        "SERVICE_START_FAILED",
                    )
                }
            }
        }
        return START_STICKY
    }

    private fun isCurrent(generation: Long): Boolean =
        synchronized(lifecycleLock) { lifecycleGeneration == generation }

    private fun currentGeneration(): Long =
        synchronized(lifecycleLock) { lifecycleGeneration }

    private fun updateIfCurrent(generation: Long, update: (VpnStatus) -> VpnStatus): Boolean =
        synchronized(lifecycleLock) {
            if (lifecycleGeneration != generation) return@synchronized false
            VpnState.update(update)
            true
        }

    /** ACTION_RELOAD while already disconnected invalidates any late queued work without starting VPN. */
    private fun invalidatePendingWork() {
        synchronized(lifecycleLock) {
            lifecycleGeneration++
            connectJob?.cancel()
            connectJob = null
            monitorJob?.cancel()
            monitorJob = null
            reconnectJob?.cancel()
            reconnectJob = null
        }
    }

    // ------------------------------------------------------------------ connect + failover
    private fun connect(candidates: List<VpnConfig>, reconnect: Boolean = false) {
        val (generation, job) = synchronized(lifecycleLock) {
            lifecycleGeneration++
            connectJob?.cancel()
            reconnectJob?.cancel()
            monitorJob?.cancel()
            val token = lifecycleGeneration
            val newJob = scope.launch(start = CoroutineStart.LAZY) {
                runConnection(candidates, reconnect, token)
            }
            connectJob = newJob
            token to newJob
        }
        job.start()
    }

    /** One generation owns the complete sequential failover pass, including each native probe. */
    private suspend fun runConnection(
        candidates: List<VpnConfig>,
        reconnect: Boolean,
        generation: Long,
    ) {
        if (!updateIfCurrent(generation) {
                it.copy(
                    phase = if (reconnect) Phase.RECONNECTING else Phase.CONNECTING,
                    error = null,
                    stopCode = null,
                )
            }
        ) return

        // With a cache, start immediately and refresh in the background. First login fetches first.
        if (Repository.session.loadConfigs()?.configs.isNullOrEmpty()) {
            if (!refreshFromServer(generation) || !isCurrent(generation)) return
        } else {
            scope.launch { refreshFromServer(generation) }
        }

        if (!isCurrent(generation)) return
        val list = Repository.configsToTry().ifEmpty { candidates }
        if (list.isEmpty()) {
            shutdown("سرور فعالی برای حساب شما وجود ندارد.", "NO_CONFIG", generation)
            return
        }

        var lastError: String? = null
        // Deliberately sequential: establish A, probe A, release A if it failed, then try B.
        for (cfg in list) {
            if (!isCurrent(generation) || !currentCoroutineContext().isActive) return
            if (!updateIfCurrent(generation) {
                    it.copy(
                        phase = if (reconnect) Phase.RECONNECTING else Phase.CONNECTING,
                        configId = cfg.id,
                        configName = cfg.name,
                    )
                }
            ) return
            updateNotification("در حال اتصال به ${cfg.name}…")

            try {
                if (!startCore(cfg, generation)) return
                if (!isCurrent(generation) || !currentCoroutineContext().isActive) {
                    stopCore(generation)
                    return
                }
                val delayMs = measureDelay(generation)
                if (delayMs != null && delayMs in 0..MAX_DELAY_MS &&
                    isCurrent(generation) && currentCoroutineContext().isActive
                ) {
                    val connected = synchronized(lifecycleLock) {
                        if (lifecycleGeneration != generation) {
                            false
                        } else {
                            current = cfg
                            VpnState.update {
                                it.copy(
                                    phase = Phase.CONNECTED,
                                    pingMs = delayMs,
                                    connectedSince = it.connectedSince ?: System.currentTimeMillis(),
                                    error = null,
                                )
                            }
                            true
                        }
                    }
                    if (!connected) return
                    updateNotification("متصل به ${cfg.name}")
                    scope.launch { Repository.api.event("connected", cfg.id) }
                    startMonitor(generation)
                    return
                }
                if (!isCurrent(generation)) return
                lastError = "سرور ${cfg.name} پاسخ نداد"
            } catch (e: Exception) {
                if (!isCurrent(generation)) return
                Log.w(TAG, "config ${cfg.id} failed", e)
                lastError = "خطا در اتصال به ${cfg.name}: ${e.message ?: "نامشخص"}"
            }

            if (!isCurrent(generation)) return
            val err = lastError
            scope.launch { Repository.api.event("failed", cfg.id, err) }
            stopCore(generation)
        }
        if (isCurrent(generation)) {
            shutdown(lastError ?: "اتصال به هیچ سروری برقرار نشد.", null, generation)
        }
    }

    /** The native delay call shares the core lock with every start/stop and is never run on Main. */
    private suspend fun measureDelay(generation: Long): Long? = withContext(Dispatchers.IO) {
        synchronized(coreLock) {
            if (!isCurrent(generation) || activeCoreGeneration != generation) {
                null
            } else {
                XrayCore.measureDelay()
            }
        }
    }

    /**
     * Pull fresh account + configs from OUR backend (never from 3X-UI).
     * Returns false (and stops) only when the backend explicitly denies service
     * (blocked / expired / quota exceeded / no config / logged out). Any other failure
     * (network, timeout, 5xx, proxy error) keeps the encrypted cached configs and the tunnel running.
     */
    private suspend fun refreshFromServer(generation: Long = currentGeneration()): Boolean {
        return try {
            val (_, bundle) = Repository.api.configs()
            if (!isCurrent(generation)) return false
            val oldVersion = Repository.session.loadConfigs()?.version
            val saved = synchronized(lifecycleLock) {
                if (lifecycleGeneration != generation) {
                    false
                } else {
                    Repository.session.saveConfigs(bundle)
                    true
                }
            }
            if (!saved) return false
            if (oldVersion != null && oldVersion != bundle.version) Log.i(TAG, "configs changed on server")
            true
        } catch (e: ApiException) {
            if (!isCurrent(generation)) return false
            when (e.code) {
                "UNAUTHORIZED" -> {
                    val revoked = synchronized(lifecycleLock) {
                        if (lifecycleGeneration != generation) false
                        else {
                            Repository.logout()
                            true
                        }
                    }
                    if (revoked) shutdown(e.message, e.code, generation)
                    false
                }
                in DENIAL_CODES -> {
                    synchronized(lifecycleLock) {
                        if (lifecycleGeneration == generation) {
                            Repository.session.saveConfigs(com.milad.vpn.data.ConfigBundle(emptyList(), "", 300))
                        }
                    }
                    shutdown(e.message, e.code, generation)
                    false
                }
                else -> {
                    Log.w(TAG, "backend refresh failed (${e.code}); using cached configs")
                    Repository.session.loadConfigs()?.configs?.isNotEmpty() == true ||
                        run {
                            shutdown(e.message, null, generation)
                            false
                        }
                }
            }
        }
    }

    private suspend fun startCore(cfg: VpnConfig, generation: Long): Boolean =
        withContext(Dispatchers.IO) {
            synchronized(coreLock) {
                if (!isCurrent(generation)) return@synchronized false
                stopCoreLocked()
                val b = Builder()
                    .setSession(cfg.name)
                    .setMtu(XrayConfigBuilder.TUN_MTU)
                    .addAddress("10.10.14.1", 30)
                    .addAddress("fd66:6666::1", 126)
                    .addRoute("0.0.0.0", 0)
                    .addRoute("::", 0)
                    .addDnsServer("1.1.1.1")
                    .addDnsServer("8.8.8.8")
                    .setBlocking(false)
                // Our own process must bypass its tunnel to avoid routing Xray/API sockets back into TUN.
                b.addDisallowedApplication(packageName)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) b.setMetered(false)
                b.setConfigureIntent(
                    PendingIntent.getActivity(
                        this@AppVpnService,
                        0,
                        Intent(this@AppVpnService, MainActivity::class.java),
                        PendingIntent.FLAG_IMMUTABLE,
                    ),
                )
                if (!isCurrent(generation)) return@synchronized false
                val fd = b.establish() ?: throw IllegalStateException("مجوز VPN داده نشده است")
                if (!isCurrent(generation)) {
                    runCatching { fd.close() }
                    return@synchronized false
                }
                tun = fd
                try {
                    XrayCore.start(XrayConfigBuilder.build(cfg.outbound), fd.fd)
                    // startLoop() is synchronous, but a newer lifecycle generation can be requested
                    // while it runs. Clean up this core before releasing coreLock if ownership changed.
                    if (!isCurrent(generation)) {
                        XrayCore.stop()
                        runCatching { fd.close() }
                        if (tun === fd) tun = null
                        activeCoreGeneration = null
                        return@synchronized false
                    }
                    activeCoreGeneration = generation
                } catch (e: Exception) {
                    runCatching { fd.close() }
                    tun = null
                    activeCoreGeneration = null
                    throw e
                }
                true
            }
        }

    private suspend fun stopCore(generation: Long) {
        withContext(Dispatchers.IO) {
            synchronized(coreLock) {
                // An old candidate may only stop the core it owns.
                if (activeCoreGeneration == generation) stopCoreLocked()
            }
        }
    }

    private fun stopCoreLocked() {
        XrayCore.stop()
        runCatching { tun?.close() }
        tun = null
        activeCoreGeneration = null
    }

    // -------------------------------------------------------------- periodic account/config sync
    private fun startMonitor(generation: Long) {
        val job = synchronized(lifecycleLock) {
            if (lifecycleGeneration != generation) return
            monitorJob?.cancel()
            scope.launch(start = CoroutineStart.LAZY) {
                runMonitor(generation)
            }.also { monitorJob = it }
        }
        job.start()
    }

    private suspend fun runMonitor(generation: Long) {
            var lastAccountCheck = System.currentTimeMillis()
            var lastConfigSync = System.currentTimeMillis()
            while (currentCoroutineContext().isActive) {
                delay(1000)
                if (!isCurrent(generation)) return

                val now = System.currentTimeMillis()
                if (now - lastAccountCheck > ACCOUNT_CHECK_MS) {
                    lastAccountCheck = now
                    try {
                        val acc = Repository.api.account()
                        if (!acc.isActive && isCurrent(generation)) {
                            shutdown(acc.statusMessage, acc.status, generation)
                            return
                        }
                    } catch (e: ApiException) {
                        val revoked = e.code == "UNAUTHORIZED" && synchronized(lifecycleLock) {
                            if (lifecycleGeneration != generation) false
                            else {
                                Repository.logout()
                                true
                            }
                        }
                        if (revoked) {
                            shutdown(e.message, e.code, generation)
                            return
                        }
                    }
                }
                if (!isCurrent(generation)) return
                val syncEvery = (Repository.session.loadConfigs()?.syncAfterSeconds ?: 300) * 1000L
                if (now - lastConfigSync > syncEvery) {
                    lastConfigSync = now
                    val currentId = synchronized(lifecycleLock) {
                        if (lifecycleGeneration == generation) current?.id else null
                    } ?: return
                    val before = Repository.session.loadConfigs()?.configs?.firstOrNull { it.id == currentId }
                    if (!refreshFromServer(generation) || !isCurrent(generation)) return
                    val after = Repository.session.loadConfigs()?.configs?.firstOrNull { it.id == currentId }
                    // current config was removed/disabled/changed from the panel -> reconnect with the new set
                    if (after == null || after.outbound != before?.outbound) {
                        if (isCurrent(generation)) connect(Repository.configsToTry(), reconnect = true)
                        return
                    }
                }
            }
    }

    private suspend fun isCoreRunning(generation: Long): Boolean = withContext(Dispatchers.IO) {
        synchronized(coreLock) {
            isCurrent(generation) &&
                activeCoreGeneration == generation &&
                XrayCore.isRunning
        }
    }

    // ------------------------------------------------------------------ network changes
    private fun registerNetworkCallback() {
        if (networkCallback != null) return
        val cm = getSystemService(ConnectivityManager::class.java)
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                if (networkCallback !== this) return
                setUnderlyingNetworks(arrayOf(network))
                val job = synchronized(lifecycleLock) {
                    val previous = currentUnderlyingNetwork
                    currentUnderlyingNetwork = network
                    val phase = VpnState.status.value.phase
                    val networkChanged = previous != null && previous != network
                    if ((!lostNetwork && !networkChanged) ||
                        phase == Phase.DISCONNECTED ||
                        reconnectJob?.isActive == true
                    ) return
                    lostNetwork = false
                    val generation = lifecycleGeneration
                    scope.launch(start = CoroutineStart.LAZY) {
                        // Let Android settle the underlying network handoff before reconnecting.
                        delay(1500)
                        if (isActive && isCurrent(generation) &&
                            VpnState.status.value.phase != Phase.DISCONNECTED
                        ) {
                            connect(Repository.configsToTry(), reconnect = true)
                        }
                    }.also { reconnectJob = it }
                }
                job.start()
            }
            override fun onLost(network: Network) {
                val changed = synchronized(lifecycleLock) {
                    if (networkCallback !== this || lifecycleGeneration == 0L) return
                    // A late onLost for the previous Wi-Fi/mobile network must not tear down
                    // a newer underlying network that has already become available.
                    if (currentUnderlyingNetwork != null && currentUnderlyingNetwork != network) return
                    currentUnderlyingNetwork = null
                    lostNetwork = true
                    if (VpnState.status.value.phase == Phase.CONNECTED) {
                        VpnState.update { it.copy(phase = Phase.RECONNECTING) }
                        true
                    } else false
                }
                if (changed) {
                    updateNotification("اینترنت قطع شد؛ در انتظار اتصال مجدد…")
                }
            }
            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                if (networkCallback === this &&
                    currentUnderlyingNetwork == network &&
                    caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
                ) {
                    setUnderlyingNetworks(arrayOf(network))
                }
            }
        }
        networkCallback = cb
        try {
            cm.registerDefaultNetworkCallback(cb)
        } catch (e: Exception) {
            if (networkCallback === cb) networkCallback = null
            throw e
        }
    }

    // ------------------------------------------------------------------ stop + notification
    private fun shutdown(
        error: String?,
        code: String?,
        ownerGeneration: Long? = null,
    ): Job? {
        val job = synchronized(lifecycleLock) {
            if (ownerGeneration != null && lifecycleGeneration != ownerGeneration) return null
            lifecycleGeneration++
            connectJob?.cancel()
            connectJob = null
            monitorJob?.cancel()
            monitorJob = null
            reconnectJob?.cancel()
            reconnectJob = null
            lostNetwork = false
            currentUnderlyingNetwork = null
            val callbackToRemove = networkCallback
            networkCallback = null
            val token = lifecycleGeneration
            val callback = callbackToRemove
            val cleanup = scope.launch(start = CoroutineStart.LAZY) {
                val last = withContext(Dispatchers.IO) {
                    synchronized(coreLock) {
                        if (!isCurrent(token)) {
                            null
                        } else {
                            val previous = current
                            stopCoreLocked()
                            val cleared = synchronized(lifecycleLock) {
                                if (lifecycleGeneration == token) {
                                    current = null
                                    true
                                } else false
                            }
                            if (cleared) previous else null
                        }
                    }
                }
                withContext(Dispatchers.Main.immediate) {
                    callback?.let {
                        runCatching {
                            getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(it)
                        }
                    }
                    if (!isCurrent(token)) return@withContext
                    if (last != null) {
                        scope.launch { Repository.api.event("disconnected", last.id) }
                    }
                    VpnState.set(VpnStatus(phase = Phase.DISCONNECTED, error = error, stopCode = code))
                    ServiceCompat.stopForeground(this@AppVpnService, ServiceCompat.STOP_FOREGROUND_REMOVE)
                    stopSelf()
                }
            }
            cleanup
        }
        job.start()
        return job
    }

    override fun onRevoke() { shutdown("اتصال VPN توسط سیستم یا برنامه دیگری قطع شد.", null) }

    override fun onDestroy() {
        val coreActive = synchronized(coreLock) { activeCoreGeneration != null }
        if (coreActive || VpnState.status.value.phase != Phase.DISCONNECTED) {
            shutdown(null, null)?.invokeOnCompletion { scope.cancel() }
        } else {
            scope.cancel()
        }
        super.onDestroy()
    }

    private fun buildNotification(text: String): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "وضعیت VPN", NotificationManager.IMPORTANCE_LOW))
        }
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, 1, Intent(this, AppVpnService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setContentIntent(open)
            .addAction(0, "قطع اتصال", stop)
            .build()
    }

    private fun startAsForeground(text: String) {
        val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0
        ServiceCompat.startForeground(this, NOTIF_ID, buildNotification(text), type)
    }

    private fun updateNotification(text: String) {
        getSystemService(NotificationManager::class.java).notify(NOTIF_ID, buildNotification(text))
    }
}
