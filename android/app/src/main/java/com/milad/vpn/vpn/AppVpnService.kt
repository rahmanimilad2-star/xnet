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
import com.milad.vpn.ui.Format
import com.milad.vpn.ui.MainActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

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
    private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private var lostNetwork = false

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> { shutdown(null, null); return START_NOT_STICKY }
            ACTION_RELOAD -> { if (VpnState.status.value.phase != Phase.DISCONNECTED) connect(Repository.configsToTry()); return START_STICKY }
            else -> {
                startAsForeground("در حال اتصال…")
                registerNetworkCallback()
                connect(Repository.configsToTry())
            }
        }
        return START_STICKY
    }

    // ------------------------------------------------------------------ connect + failover
    private fun connect(candidates: List<VpnConfig>, reconnect: Boolean = false) {
        connectJob?.cancel()
        connectJob = scope.launch {
            VpnState.update { it.copy(phase = if (reconnect) Phase.RECONNECTING else Phase.CONNECTING, error = null, stopCode = null) }
            // Connecting never waits on a remote panel: if configs are cached we start the core right away
            // and refresh from our backend in the background. Only with an empty cache (first run) do we fetch first.
            if (Repository.session.loadConfigs()?.configs.isNullOrEmpty()) {
                if (!refreshFromServer()) return@launch
            } else {
                scope.launch { refreshFromServer() }
            }
            val list = Repository.configsToTry().ifEmpty { candidates }
            if (list.isEmpty()) { shutdown("سرور فعالی برای حساب شما وجود ندارد.", "NO_CONFIG"); return@launch }

            var lastError: String? = null
            for (cfg in list) {
                if (!isActive) return@launch
                VpnState.update { it.copy(phase = if (reconnect) Phase.RECONNECTING else Phase.CONNECTING, configId = cfg.id, configName = cfg.name) }
                updateNotification("در حال اتصال به ${cfg.name}…")
                try {
                    startCore(cfg)
                    val delayMs = XrayCore.measureDelay()
                    if (delayMs in 0..MAX_DELAY_MS) {
                        current = cfg
                        VpnState.update {
                            it.copy(phase = Phase.CONNECTED, pingMs = delayMs, connectedSince = it.connectedSince ?: System.currentTimeMillis(), error = null)
                        }
                        updateNotification("متصل به ${cfg.name}")
                        scope.launch { Repository.api.event("connected", cfg.id) } // fire-and-forget
                        startMonitor()
                        return@launch
                    }
                    lastError = "سرور ${cfg.name} پاسخ نداد"
                } catch (e: Exception) {
                    Log.w(TAG, "config ${cfg.id} failed", e)
                    lastError = "خطا در اتصال به ${cfg.name}: ${e.message ?: "نامشخص"}"
                }
                val err = lastError
                scope.launch { Repository.api.event("failed", cfg.id, err) } // fire-and-forget
                stopCore()
            }
            shutdown(lastError ?: "اتصال به هیچ سروری برقرار نشد.", null)
        }
    }

    /**
     * Pull fresh account + configs from OUR backend (never from 3X-UI).
     * Returns false (and stops) only when the backend explicitly denies service
     * (blocked / expired / quota exceeded / no config / logged out). Any other failure
     * (network, timeout, 5xx, proxy error) keeps the encrypted cached configs and the tunnel running.
     */
    private suspend fun refreshFromServer(): Boolean {
        return try {
            val (_, bundle) = Repository.api.configs()
            val oldVersion = Repository.session.loadConfigs()?.version
            Repository.session.saveConfigs(bundle)
            if (oldVersion != null && oldVersion != bundle.version) Log.i(TAG, "configs changed on server")
            true
        } catch (e: ApiException) {
            when (e.code) {
                "UNAUTHORIZED" -> { Repository.logout(); shutdown(e.message, e.code); false }
                in DENIAL_CODES -> {
                    Repository.session.saveConfigs(com.milad.vpn.data.ConfigBundle(emptyList(), "", 300))
                    shutdown(e.message, e.code); false
                }
                else -> {
                    Log.w(TAG, "backend refresh failed (${e.code}); using cached configs")
                    Repository.session.loadConfigs()?.configs?.isNotEmpty() == true ||
                        run { shutdown(e.message, null); false }
                }
            }
        }
    }

    private fun startCore(cfg: VpnConfig) {
        stopCore()
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
        // Our own process (core's outbound sockets + API calls) must bypass the tunnel to avoid loops.
        b.addDisallowedApplication(packageName)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) b.setMetered(false)
        b.setConfigureIntent(PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE))
        val fd = b.establish() ?: throw IllegalStateException("مجوز VPN داده نشده است")
        tun = fd
        XrayCore.start(XrayConfigBuilder.build(cfg.outbound), fd.fd)
    }

    private fun stopCore() {
        XrayCore.stop()
        runCatching { tun?.close() }
        tun = null
    }

    // -------------------------------------------------------------- live stats + periodic sync
    private fun startMonitor() {
        monitorJob?.cancel()
        monitorJob = scope.launch {
            var lastAccountCheck = System.currentTimeMillis()
            var lastConfigSync = System.currentTimeMillis()
            while (isActive) {
                delay(1000)
                val up = XrayCore.queryStats("proxy", "uplink")
                val down = XrayCore.queryStats("proxy", "downlink")
                VpnState.update { it.copy(upSpeed = up, downSpeed = down, sessionUp = it.sessionUp + up, sessionDown = it.sessionDown + down) }
                if (VpnState.status.value.phase == Phase.CONNECTED) {
                    updateNotification("متصل به ${current?.name} · ↓ ${Format.speed(down)} ↑ ${Format.speed(up)}")
                }

                val now = System.currentTimeMillis()
                if (now - lastAccountCheck > ACCOUNT_CHECK_MS) {
                    lastAccountCheck = now
                    try {
                        val acc = Repository.api.account()
                        if (!acc.isActive) { shutdown(acc.statusMessage, acc.status); return@launch }
                    } catch (e: ApiException) {
                        if (e.code == "UNAUTHORIZED") { Repository.logout(); shutdown(e.message, e.code); return@launch }
                    }
                }
                val syncEvery = (Repository.session.loadConfigs()?.syncAfterSeconds ?: 300) * 1000L
                if (now - lastConfigSync > syncEvery) {
                    lastConfigSync = now
                    val before = Repository.session.loadConfigs()?.configs?.firstOrNull { it.id == current?.id }
                    if (!refreshFromServer()) return@launch
                    val after = Repository.session.loadConfigs()?.configs?.firstOrNull { it.id == current?.id }
                    // current config was removed/disabled/changed from the panel -> reconnect with the new set
                    if (after == null || after.outbound != before?.outbound) { connect(Repository.configsToTry(), reconnect = true); return@launch }
                }
                // core died unexpectedly -> failover
                if (!XrayCore.isRunning && VpnState.status.value.phase == Phase.CONNECTED) {
                    connect(Repository.configsToTry(), reconnect = true); return@launch
                }
            }
        }
    }

    // ------------------------------------------------------------------ network changes
    private fun registerNetworkCallback() {
        if (networkCallback != null) return
        val cm = getSystemService(ConnectivityManager::class.java)
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                setUnderlyingNetworks(arrayOf(network))
                if (lostNetwork && VpnState.status.value.phase != Phase.DISCONNECTED) {
                    lostNetwork = false
                    scope.launch { delay(1500); connect(Repository.configsToTry(), reconnect = true) }
                }
            }
            override fun onLost(network: Network) {
                lostNetwork = true
                if (VpnState.status.value.phase == Phase.CONNECTED) {
                    VpnState.update { it.copy(phase = Phase.RECONNECTING, upSpeed = 0, downSpeed = 0) }
                    updateNotification("اینترنت قطع شد؛ در انتظار اتصال مجدد…")
                }
            }
            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                if (caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) setUnderlyingNetworks(arrayOf(network))
            }
        }
        cm.registerDefaultNetworkCallback(cb)
        networkCallback = cb
    }

    // ------------------------------------------------------------------ stop + notification
    private fun shutdown(error: String?, code: String?) {
        connectJob?.cancel(); monitorJob?.cancel()
        val last = current
        stopCore()
        current = null
        networkCallback?.let { runCatching { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(it) } }
        networkCallback = null
        if (last != null) scope.launch { Repository.api.event("disconnected", last.id) }
        VpnState.set(VpnStatus(phase = Phase.DISCONNECTED, error = error, stopCode = code))
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onRevoke() { shutdown("اتصال VPN توسط سیستم یا برنامه دیگری قطع شد.", null) }

    override fun onDestroy() {
        if (VpnState.status.value.phase != Phase.DISCONNECTED) shutdown(null, null)
        scope.cancel()
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
