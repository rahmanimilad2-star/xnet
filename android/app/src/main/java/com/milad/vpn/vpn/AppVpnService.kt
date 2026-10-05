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
import com.milad.vpn.data.ConfigBundle
import com.milad.vpn.data.Repository
import com.milad.vpn.data.VpnConfig
import com.milad.vpn.ui.MainActivity
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Real VPN: Android VpnService creates the TUN interface, Xray-core (libv2ray) reads/writes the
 * packets and tunnels them through the chosen outbound.
 *
 * Single connection owner: one session coroutine per generation ([SessionOwner]). It runs a plan loop:
 *   establish (Full | Ordered | Switch) -> CONNECTED -> monitor -> next plan or end.
 * Only the session decides to reconnect or switch. Network callbacks, the UI and refreshes merely
 * send signals. Policy lives in [ServerSelector] (pure, unit-tested).
 * Every decision is logged under "XnetVpn" (adb logcat -s XnetVpn).
 */
class AppVpnService : VpnService() {

    companion object {
        private const val TAG = "XnetVpn"
        const val ACTION_START = "com.milad.vpn.START"
        const val ACTION_STOP = "com.milad.vpn.STOP"
        /** "Selection or configs may have changed, re-evaluate". Never a blind reconnect. */
        const val ACTION_RELOAD = "com.milad.vpn.RELOAD"
        private const val CHANNEL = "vpn_status"
        private const val NOTIF_ID = 1

        private const val TICK_MS = 2_000L
        /** isRunning must be false on this many consecutive ticks before the core counts as dead. */
        private const val CORE_DOWN_TICKS = 2
        private const val HEALTH_INTERVAL_MS = 60_000L
        private const val HEALTH_RETRY_MS = 5_000L
        private const val HEALTH_FAILURES_TO_ACT = 3
        private const val ACCOUNT_CHECK_MS = 60_000L
        /** Max time a refresh waits for the backend before the encrypted cache is used. */
        private const val REFRESH_BUDGET_MS = 8_000L
        /** Max time for probing all locations (in parallel). */
        private const val PROBE_BUDGET_MS = 15_000L
        private const val PROBE_PARALLELISM = 4

        private const val WAKE_NETWORK = "network"
        private const val WAKE_REEVALUATE = "reevaluate"

        fun start(ctx: Context) = send(ctx, ACTION_START)
        fun stop(ctx: Context) = send(ctx, ACTION_STOP)
        fun reload(ctx: Context) = send(ctx, ACTION_RELOAD)
        private fun send(ctx: Context, action: String) {
            val i = Intent(ctx, AppVpnService::class.java).setAction(action)
            if (action == ACTION_START) ctx.startForegroundService(i) else ctx.startService(i)
        }
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    /** Generation owner; also the lock for every field marked "guarded by owner". */
    private val owner = SessionOwner()
    private val coreLock = Any()

    // ---- guarded by owner
    private var sessionJob: Job? = null
    private var cleanupJob: Job? = null
    /** Config the tunnel is running on (set only when CONNECTED). */
    private var current: VpnConfig? = null
    /** selectedConfigId the running session works with. */
    private var sessionSelection: Long = ServerSelector.AUTO
    private val reconnectBudget = ServerSelector.ReconnectBudget()

    // ---- guarded by coreLock
    private var tun: ParcelFileDescriptor? = null
    /** Which session generation owns the currently started core/TUN. */
    private var activeCoreGeneration: Long? = null

    // ---- network: signals only
    @Volatile private var networkCallback: ConnectivityManager.NetworkCallback? = null
    private val net = NetworkTracker<Network>()

    /** Signals for the running session. Buffered so a selection change is not lost behind a network blip. */
    private val wake = Channel<String>(capacity = 16)

    // ------------------------------------------------------------------ plans
    private sealed interface Plan {
        /** refresh -> validate -> manual target, or probe + rank all -> try in latency order. */
        data class Full(val reconnect: Boolean, val reason: String) : Plan
        /** Already ranked by a fresh probe (running config removed/changed). */
        data class Ordered(val candidates: List<VpnConfig>, val version: String?, val reason: String) : Plan
        /** Healthy tunnel, confirmed better server: switch once; fall back to [previous] if the target fails. */
        data class Switch(val target: VpnConfig, val previous: VpnConfig, val version: String?) : Plan
    }

    /** What the monitor wants next. automatic = charged to the reconnect budget. */
    private data class Next(val plan: Plan, val automatic: Boolean)

    /** A verified tunnel and the backend version its choice was based on. */
    private data class Link(val config: VpnConfig, val version: String?)

    private sealed interface Attempt {
        object Stale : Attempt
        data class Connected(val delayMs: Long) : Attempt
        data class Failed(val error: String) : Attempt
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                Log.i(TAG, "stop requested by user")
                shutdown(null, null)
                return START_NOT_STICKY
            }
            ACTION_RELOAD -> {
                if (reevaluate()) return START_STICKY
                // Nothing running: never leave a sticky idle service (a sticky restart would switch VPN on).
                stopIfIdle(startId)
                return START_NOT_STICKY
            }
            else -> {
                // ACTION_START, always-on ("android.net.VpnService") or a sticky restart (null intent).
                val trigger = if (intent == null) "system restart" else "start (${intent.action})"
                try {
                    startAsForeground(notificationText())
                    if (sessionActive()) {
                        Log.i(TAG, "$trigger ignored: a session is already running (${VpnState.status.value.phase})")
                        return START_STICKY
                    }
                    if (!Repository.isLoggedIn) {
                        shutdown(null, null)
                        return START_NOT_STICKY
                    }
                    registerNetworkCallback()
                    synchronized(owner) { reconnectBudget.reset() }
                    beginSession(trigger, reconnect = false)
                } catch (e: Exception) {
                    Log.e(TAG, "VPN service startup failed", e)
                    shutdown("خطا در راه‌اندازی سرویس VPN: ${e.message ?: "نامشخص"}", "SERVICE_START_FAILED")
                }
            }
        }
        return START_STICKY
    }

    // ------------------------------------------------------------------ ownership helpers
    private fun isCurrent(generation: Long): Boolean = owner.isCurrent(generation)

    private fun updateIfCurrent(generation: Long, update: (VpnStatus) -> VpnStatus): Boolean =
        owner.ifCurrent(generation) { VpnState.update(update); true } ?: false

    private fun sessionActive(): Boolean = synchronized(owner) { sessionJob?.isCompleted == false }

    private fun stopIfIdle(startId: Int) {
        val idle = synchronized(owner) { sessionJob?.isCompleted != false && cleanupJob?.isCompleted != false }
        val coreIdle = synchronized(coreLock) { activeCoreGeneration == null }
        if (idle && coreIdle) stopSelf(startId)
    }

    /** User/system-initiated start of a new generation. The previous session is cancelled. */
    private fun beginSession(reason: String, reconnect: Boolean) {
        val job = synchronized(owner) {
            val token = owner.next()
            sessionJob?.cancel()
            sessionSelection = Repository.session.selectedConfigId
            Log.i(TAG, "session #$token: $reason (selection=${if (sessionSelection < 0) "auto" else sessionSelection.toString()})")
            scope.launch(start = CoroutineStart.LAZY) { runSession(token, reconnect) }.also { sessionJob = it }
        }
        job.start()
    }

    /** ACTION_RELOAD: selection or configs may have changed. Returns false if no session exists. */
    private fun reevaluate(): Boolean {
        val restart = synchronized(owner) {
            if (sessionJob?.isCompleted != false) return false
            val connected = VpnState.status.value.phase == Phase.CONNECTED && current != null
            // While still connecting, a different selection makes the running plan obsolete.
            !connected && Repository.session.selectedConfigId != sessionSelection
        }
        if (restart) beginSession("selection changed while connecting", reconnect = false)
        else wake.trySend(WAKE_REEVALUATE) // the session's monitor evaluates against the RUNNING tunnel
        return true
    }

    // ------------------------------------------------------------------ the session (single owner)
    private suspend fun runSession(generation: Long, reconnect: Boolean) {
        var plan: Plan = Plan.Full(reconnect, "start")
        while (true) {
            val link = when (val p = plan) {
                is Plan.Full -> establishFull(generation, p.reconnect)
                is Plan.Ordered -> establishOrdered(generation, p)
                is Plan.Switch -> establishSwitch(generation, p)
            } ?: return
            val next = monitor(generation, link) ?: return
            if (next.automatic) {
                val allowed = owner.ifCurrent(generation) { reconnectBudget.tryAcquire(System.currentTimeMillis()) } ?: return
                if (!allowed) {
                    Log.w(TAG, "automatic action refused by budget: ${next.plan}")
                    shutdown("اتصال پایدار نماند و چند بار پشت‌سرهم قطع شد. سرور دیگری را امتحان کنید.", null, generation)
                    return
                }
            }
            plan = next.plan
        }
    }

    /** Initial connect / genuine reconnect. null = session ended (shutdown already called or stale). */
    private suspend fun establishFull(generation: Long, reconnect: Boolean): Link? {
        val phase = if (reconnect) Phase.RECONNECTING else Phase.CONNECTING
        if (!updateIfCurrent(generation) {
                it.copy(
                    phase = phase, error = null, stopCode = null, detail = "بروزرسانی لیست سرورها…",
                    connectedSince = if (reconnect) it.connectedSince else null,
                    pingMs = if (reconnect) it.pingMs else null,
                )
            }
        ) return null
        updateNotification(if (reconnect) "در حال اتصال مجدد…" else "در حال اتصال…")

        if (!hasUnderlyingNetwork()) {
            shutdown("اینترنت در دسترس نیست. اتصال اینترنت گوشی را بررسی کنید.", null, generation)
            return null
        }

        // 1) refresh from the backend (bounded; transient failure -> encrypted cache)
        val refreshed = refresh(generation)
        if (refreshed is Refresh.Stopped || !isCurrent(generation)) return null
        val bundle = Repository.session.loadConfigs()
        val version = bundle?.version

        // 2) validate
        val all = bundle?.configs.orEmpty()
        val valid = ServerSelector.validConfigs(all)
        if (valid.isEmpty()) {
            shutdown(
                if (all.isEmpty()) "سرور فعالی برای حساب شما وجود ندارد." else "هیچ‌کدام از کانفیگ‌های حساب شما معتبر نیست.",
                "NO_CONFIG", generation,
            )
            return null
        }

        // 3) manual: that location only, no probing of others, no fallback
        val selected = synchronized(owner) { sessionSelection }
        if (selected >= 0) {
            val manual = valid.firstOrNull { it.id == selected }
            if (manual != null) {
                return when (val r = attempt(generation, manual, phase)) {
                    Attempt.Stale -> null
                    is Attempt.Connected -> markConnected(generation, manual, r.delayMs, version)
                    is Attempt.Failed -> {
                        shutdown("اتصال به «${manual.name}» برقرار نشد: ${r.error}. لوکیشن دیگری یا «خودکار» را انتخاب کنید.", null, generation)
                        null
                    }
                }
            }
            if (!switchSelectionToAuto(generation, selected)) return null
        }

        // 4) Auto: probe ALL valid configs, rank by real latency, try in that order
        if (!updateIfCurrent(generation) { it.copy(phase = phase, detail = "سنجش پینگ ${valid.size} سرور…") }) return null
        val probes = probeAll(generation, valid) ?: return null
        val ranked = ServerSelector.rankByLatency(probes)
        logRanking("initial", probes)
        if (ranked.isEmpty()) {
            shutdown(ServerSelector.describeFailure(probes), null, generation)
            return null
        }
        return tryInOrder(generation, ranked.map { it.config }, phase, version)
            ?: run { if (isCurrent(generation)) shutdown(lastFailure ?: "اتصال به هیچ سروری برقرار نشد.", null, generation); null }
    }

    /** Candidates already ranked by a fresh probe; if none works, run a Full pass once more. */
    private suspend fun establishOrdered(generation: Long, plan: Plan.Ordered): Link? {
        Log.i(TAG, "ordered reconnect: ${plan.reason} -> ${plan.candidates.map { it.id }}")
        return tryInOrder(generation, plan.candidates, Phase.RECONNECTING, plan.version)
            ?: if (isCurrent(generation)) establishFull(generation, reconnect = true) else null
    }

    /** One controlled switch. The previous (healthy) server is the fallback, then a Full pass. */
    private suspend fun establishSwitch(generation: Long, plan: Plan.Switch): Link? {
        Log.i(TAG, "switching ${plan.previous.id} -> ${plan.target.id}")
        when (val r = attempt(generation, plan.target, Phase.RECONNECTING)) {
            Attempt.Stale -> return null
            is Attempt.Connected -> return markConnected(generation, plan.target, r.delayMs, plan.version)
            is Attempt.Failed -> Log.w(TAG, "switch target failed (${r.error}); restoring ${plan.previous.id}")
        }
        when (val r = attempt(generation, plan.previous, Phase.RECONNECTING)) {
            Attempt.Stale -> return null
            is Attempt.Connected -> return markConnected(generation, plan.previous, r.delayMs, plan.version)
            is Attempt.Failed -> Log.w(TAG, "previous server failed too (${r.error})")
        }
        return if (isCurrent(generation)) establishFull(generation, reconnect = true) else null
    }

    /** Last attempt error of this service (only read by the owner right after tryInOrder). */
    @Volatile private var lastFailure: String? = null

    private suspend fun tryInOrder(generation: Long, candidates: List<VpnConfig>, phase: Phase, version: String?): Link? {
        lastFailure = null
        for (cfg in candidates) {
            when (val r = attempt(generation, cfg, phase)) {
                Attempt.Stale -> return null
                is Attempt.Connected -> return markConnected(generation, cfg, r.delayMs, version)
                is Attempt.Failed -> lastFailure = r.error
            }
        }
        return null
    }

    private fun switchSelectionToAuto(generation: Long, removedId: Long): Boolean {
        val ok = owner.ifCurrent(generation) {
            Repository.session.selectedConfigId = ServerSelector.AUTO
            sessionSelection = ServerSelector.AUTO
        } != null
        if (ok) Log.i(TAG, "selected config $removedId no longer exists on the server: selection persisted as Auto")
        return ok
    }

    /** Start TUN + Xray for one config and verify it with a real request THROUGH the tunnel. */
    private suspend fun attempt(generation: Long, cfg: VpnConfig, phase: Phase): Attempt {
        if (!updateIfCurrent(generation) {
                it.copy(phase = phase, configId = cfg.id, configName = cfg.name, detail = "اتصال به ${cfg.name}…")
            }
        ) return Attempt.Stale
        updateNotification("در حال اتصال به ${cfg.name}…")
        val error = try {
            if (!startCore(cfg, generation)) return Attempt.Stale
            val delayMs = tunnelDelay(generation) ?: return Attempt.Stale
            if (delayMs > 0) return Attempt.Connected(delayMs)
            "سرور ${cfg.name} از داخل تونل پاسخ نداد"
        } catch (e: Exception) {
            if (!isCurrent(generation)) return Attempt.Stale
            Log.w(TAG, "config ${cfg.id} failed", e)
            "خطا در اجرای ${cfg.name}: ${e.message ?: "نامشخص"}"
        }
        if (!isCurrent(generation)) return Attempt.Stale
        Log.i(TAG, "attempt failed: ${cfg.id} ($error)")
        scope.launch { Repository.api.event("failed", cfg.id, error) }
        stopCore(generation) // a failed candidate never leaves a running core or an open TUN behind
        return Attempt.Failed(error)
    }

    /** CONNECTED is only ever set here, after a successful in-tunnel request. */
    private fun markConnected(generation: Long, cfg: VpnConfig, delayMs: Long, version: String?): Link? {
        val ok = owner.ifCurrent(generation) {
            current = cfg
            VpnState.update {
                it.copy(
                    phase = Phase.CONNECTED, configId = cfg.id, configName = cfg.name, pingMs = delayMs,
                    connectedSince = it.connectedSince ?: System.currentTimeMillis(), error = null, detail = null,
                )
            }
        } != null
        if (!ok) return null
        Log.i(TAG, "connected: ${cfg.id} ${cfg.name} (${delayMs} ms, version=$version)")
        updateNotification("متصل به ${cfg.name}")
        scope.launch { Repository.api.event("connected", cfg.id) }
        return Link(cfg, version)
    }

    /** Probe every config through its own temporary Xray instance, in parallel, within one budget. */
    private suspend fun probeAll(generation: Long, configs: List<VpnConfig>): List<ServerSelector.Probe>? {
        val gate = Semaphore(PROBE_PARALLELISM)
        val pending = configs.map { cfg -> cfg to scope.async { gate.withPermit { XrayCore.probe(cfg.outbound) } } }
        val deadline = System.currentTimeMillis() + PROBE_BUDGET_MS
        try {
            val results = pending.map { (cfg, d) ->
                val left = deadline - System.currentTimeMillis()
                val r = if (left > 0) withTimeoutOrNull(left) { d.await() } else null
                if (r == null) ServerSelector.Probe(cfg, null, "پاسخی در ${PROBE_BUDGET_MS / 1000} ثانیه نداد")
                else ServerSelector.Probe(cfg, r.ms, r.error)
            }
            return if (isCurrent(generation)) results else null
        } finally {
            // Probes still waiting for a slot never run; one already inside native code finishes and is discarded.
            pending.forEach { it.second.cancel() }
        }
    }

    private fun logRanking(why: String, probes: List<ServerSelector.Probe>) {
        Log.i(TAG, "ranking ($why): " + probes.sortedBy { it.delayMs ?: Long.MAX_VALUE }
            .joinToString { "${it.config.id}=${it.delayMs ?: "x(${it.error})"}" })
    }

    // ------------------------------------------------------------------ monitor (same session)
    /**
     * Health monitoring and Auto re-ranking are separate:
     * - health: core liveness + in-tunnel requests; acts only on consecutive failures.
     * - re-ranking: only when the backend version (or the selection) changed, with explicit probes.
     * Returns the next plan, or null if the session ended.
     */
    private suspend fun monitor(generation: Long, link: Link): Next? {
        var running = link.config
        var knownVersion = link.version
        val health = ServerSelector.HealthTracker(HEALTH_FAILURES_TO_ACT)
        var coreDownTicks = 0
        var pendingReevaluate = false
        val start = System.currentTimeMillis()
        var nextHealthAt = start + HEALTH_INTERVAL_MS
        var lastAccount = start
        var nextSyncAt = start + ServerSelector.syncIntervalMs(Repository.session.loadConfigs())
        while (true) {
            val signal = withTimeoutOrNull(TICK_MS) { wake.receive() }
            if (!isCurrent(generation)) return null
            val now = System.currentTimeMillis()
            if (signal == WAKE_REEVALUATE) pendingReevaluate = true

            // No underlying network: keep TUN + core, never reconnect into nothing.
            if (!net.available) continue
            if (signal == WAKE_NETWORK) nextHealthAt = now // network came back / switched: verify, don't rebuild

            // 1) core liveness: one false sample is not a crash
            when (isCoreRunning(generation)) {
                null -> return null
                true -> coreDownTicks = 0
                false -> if (++coreDownTicks >= CORE_DOWN_TICKS) {
                    Log.w(TAG, "core not running for $coreDownTicks consecutive checks")
                    return Next(Plan.Full(true, "core stopped"), automatic = true)
                }
            }

            // 2) UI saved a new bundle or changed the selection
            if (pendingReevaluate) {
                pendingReevaluate = false
                when (val e = evaluate(generation, running, knownVersion, Repository.session.loadConfigs())) {
                    is Eval.Keep -> { running = e.running; knownVersion = e.version }
                    is Eval.Act -> return e.next
                    Eval.Ended -> return null
                }
            }

            // 3) health: is the tunnel actually usable?
            if (now >= nextHealthAt) {
                val d = tunnelDelay(generation) ?: return null
                if (d > 0) {
                    health.success()
                    nextHealthAt = System.currentTimeMillis() + HEALTH_INTERVAL_MS
                    val restored = owner.ifCurrent(generation) {
                        val wasReconnecting = VpnState.status.value.phase != Phase.CONNECTED
                        VpnState.update { it.copy(phase = Phase.CONNECTED, pingMs = d, detail = null) }
                        wasReconnecting
                    } ?: return null
                    if (restored) updateNotification("متصل به ${running.name}")
                } else if (!health.failure()) {
                    nextHealthAt = System.currentTimeMillis() + HEALTH_RETRY_MS // temporary request failure
                } else {
                    val reachable = Repository.api.reachable()
                    if (!isCurrent(generation)) return null
                    when (ServerSelector.classifyTunnelFailure(net.validated, reachable)) {
                        ServerSelector.TunnelVerdict.TUNNEL_DOWN ->
                            return Next(Plan.Full(true, "tunnel unusable (${health.consecutiveFailures} failed checks)"), automatic = true)
                        ServerSelector.TunnelVerdict.NETWORK_DOWN -> {
                            Log.i(TAG, "in-tunnel checks fail but the network itself is down: waiting")
                            health.success()
                            nextHealthAt = System.currentTimeMillis() + HEALTH_RETRY_MS
                            updateIfCurrent(generation) { it.copy(phase = Phase.RECONNECTING, detail = "در انتظار اینترنت…") }
                        }
                    }
                }
            }

            // 4) account still allowed?
            if (now - lastAccount >= ACCOUNT_CHECK_MS) {
                lastAccount = now
                if (!checkAccount(generation)) return null
            }

            // 5) subscription refresh every sync_after_seconds, independent of the UI
            if (now >= nextSyncAt) {
                when (val r = refresh(generation)) {
                    Refresh.Stopped -> return null
                    Refresh.Cached -> nextSyncAt = System.currentTimeMillis() + ServerSelector.syncIntervalMs(Repository.session.loadConfigs())
                    is Refresh.Fresh -> {
                        nextSyncAt = System.currentTimeMillis() + ServerSelector.syncIntervalMs(r.bundle)
                        when (val e = evaluate(generation, running, knownVersion, r.bundle)) {
                            is Eval.Keep -> { running = e.running; knownVersion = e.version }
                            is Eval.Act -> return e.next
                            Eval.Ended -> return null
                        }
                    }
                }
            }
        }
    }

    private sealed interface Eval {
        data class Keep(val running: VpnConfig, val version: String?) : Eval
        data class Act(val next: Next) : Eval
        object Ended : Eval
    }

    /**
     * Fresh bundle and/or selection vs. the RUNNING tunnel.
     * Unchanged version + unchanged selection -> nothing at all (no probes, no reconnect).
     */
    private suspend fun evaluate(generation: Long, running: VpnConfig, knownVersion: String?, bundle: ConfigBundle?): Eval {
        if (bundle == null) return Eval.Keep(running, knownVersion)
        val selected = Repository.session.selectedConfigId
        val selectionChanged = selected != synchronized(owner) { sessionSelection }
        if (!ServerSelector.hasNewData(knownVersion, bundle) && !selectionChanged) return Eval.Keep(running, knownVersion)

        val valid = ServerSelector.validConfigs(bundle.configs)
        val impact = ServerSelector.impactOn(running, valid)
        val freshRunning = valid.firstOrNull { it.id == running.id && impact == ServerSelector.Impact.NONE } ?: running
        Log.i(TAG, "evaluate: version ${knownVersion?.take(8)} -> ${bundle.version.take(8)}, selection=$selected, running=${running.id} $impact")

        if (selected >= 0) {
            val target = valid.firstOrNull { it.id == selected }
            when {
                target == null -> {
                    if (!switchSelectionToAuto(generation, selected)) return Eval.Ended
                    // fall through to Auto below
                }
                selected != running.id ->
                    return Eval.Act(Next(Plan.Full(true, "user selected location $selected"), automatic = false))
                impact == ServerSelector.Impact.CHANGED ->
                    return Eval.Act(Next(Plan.Full(true, "selected config changed on server"), automatic = true))
                else -> {
                    owner.ifCurrent(generation) { sessionSelection = selected } ?: return Eval.Ended
                    return Eval.Keep(freshRunning, bundle.version) // manual: never re-ranked
                }
            }
        }

        // Auto: probe ALL valid candidates (running one included, with its current outbound)
        owner.ifCurrent(generation) { sessionSelection = ServerSelector.AUTO } ?: return Eval.Ended
        if (valid.isEmpty()) return Eval.Act(Next(Plan.Full(true, "no valid config left"), automatic = true))
        val probes = probeAll(generation, valid) ?: return Eval.Ended
        logRanking("re-rank", probes)
        return when (val d = ServerSelector.decide(running, impact, probes)) {
            ServerSelector.Decision.Keep -> Eval.Keep(freshRunning, bundle.version)
            is ServerSelector.Decision.Reconnect -> Eval.Act(
                Next(
                    if (d.candidates.isEmpty()) Plan.Full(true, "running config $impact, no probe succeeded")
                    else Plan.Ordered(d.candidates, bundle.version, "running config ${running.id} $impact"),
                    automatic = true,
                ),
            )
            is ServerSelector.Decision.Switch -> {
                // Confirm with a second, fresh measurement of both before touching a healthy tunnel.
                val confirm = probeAll(generation, listOf(freshRunning, d.target)) ?: return Eval.Ended
                val again = ServerSelector.decide(freshRunning, ServerSelector.Impact.NONE, confirm)
                if (again is ServerSelector.Decision.Switch && again.target.id == d.target.id) {
                    Log.i(TAG, "better server confirmed: ${d.target.id} (-${again.gainMs} ms)")
                    Eval.Act(Next(Plan.Switch(d.target, freshRunning, bundle.version), automatic = true))
                } else {
                    Log.i(TAG, "better server not confirmed on re-probe: keeping ${running.id}")
                    Eval.Keep(freshRunning, bundle.version)
                }
            }
        }
    }

    private suspend fun checkAccount(generation: Long): Boolean {
        try {
            val acc = Repository.api.account()
            Repository.publishAccount(acc)
            if (!acc.isActive) {
                shutdown(acc.statusMessage, acc.status, generation)
                return false
            }
        } catch (e: ApiException) {
            if (e.code == "UNAUTHORIZED") {
                val revoked = owner.ifCurrent(generation) { Repository.logout() } != null
                if (revoked) shutdown(e.message, e.code, generation)
                return false
            }
            // network / 5xx: transient, the tunnel keeps running
        }
        return isCurrent(generation)
    }

    // ------------------------------------------------------------------ backend refresh
    private sealed interface Refresh {
        data class Fresh(val bundle: ConfigBundle) : Refresh
        object Cached : Refresh
        object Stopped : Refresh
    }

    /**
     * GET /api/v1/configs from OUR backend, bounded by REFRESH_BUDGET_MS.
     * Success -> save bundle (configs, version, sync interval) + publish account.
     * Transient (timeout, network, 5xx, proxy) -> keep the cached bundle, tunnel untouched.
     * UNAUTHORIZED / BLOCKED / EXPIRED / QUOTA_EXCEEDED / NO_CONFIG -> existing contract (stop).
     */
    private suspend fun refresh(generation: Long): Refresh {
        val call = scope.async { runCatching { Repository.api.configs() } }
        val res = withTimeoutOrNull(REFRESH_BUDGET_MS) { call.await() }
        if (!isCurrent(generation)) return Refresh.Stopped
        val haveCache = !Repository.session.loadConfigs()?.configs.isNullOrEmpty()
        fun cacheOrStop(why: String?): Refresh {
            Log.w(TAG, "backend refresh failed (${why ?: "timeout"}); ${if (haveCache) "keeping cached configs" else "no cache"}")
            if (haveCache) return Refresh.Cached
            shutdown(why ?: "سرور مدیریت پاسخ نداد. اتصال اینترنت را بررسی کنید.", null, generation)
            return Refresh.Stopped
        }
        if (res == null) return cacheOrStop(null)
        res.getOrNull()?.let { (account, bundle) ->
            val saved = owner.ifCurrent(generation) { Repository.session.saveConfigs(bundle) } != null
            if (!saved) return Refresh.Stopped
            Repository.publishAccount(account)
            return Refresh.Fresh(bundle)
        }
        val failure = res.exceptionOrNull()
        val e = failure as? ApiException ?: return cacheOrStop(failure?.message)
        return when (ServerSelector.classifyRefreshError(e.code)) {
            ServerSelector.RefreshKind.LOGGED_OUT -> {
                val revoked = owner.ifCurrent(generation) { Repository.logout() } != null
                if (revoked) shutdown(e.message, e.code, generation)
                Refresh.Stopped
            }
            ServerSelector.RefreshKind.DENIED -> {
                owner.ifCurrent(generation) { Repository.session.saveConfigs(ConfigBundle(emptyList(), "", ServerSelector.DEFAULT_SYNC_SECONDS)) }
                shutdown(e.message, e.code, generation)
                Refresh.Stopped
            }
            ServerSelector.RefreshKind.TRANSIENT -> cacheOrStop(e.message)
        }
    }

    // ------------------------------------------------------------------ native core (coreLock)
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
                // Our own process bypasses its tunnel: Xray, probes and API sockets use the real network.
                b.addDisallowedApplication(packageName)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) b.setMetered(false)
                b.setConfigureIntent(
                    PendingIntent.getActivity(
                        this@AppVpnService, 0, Intent(this@AppVpnService, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE,
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
                    // startLoop() is synchronous but ownership can change while it runs.
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
                // A session may only stop the core it owns.
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

    /**
     * Real request through the running tunnel core. null = this session no longer owns the core.
     * The native call runs OUTSIDE coreLock so a slow check never delays STOP or a new session.
     */
    private suspend fun tunnelDelay(generation: Long): Long? = withContext(Dispatchers.IO) {
        val owned = synchronized(coreLock) { isCurrent(generation) && activeCoreGeneration == generation }
        if (!owned) return@withContext null
        val d = XrayCore.measureDelay()
        val stillOwned = synchronized(coreLock) { isCurrent(generation) && activeCoreGeneration == generation }
        if (stillOwned) d else null
    }

    /** null = stale session. */
    private suspend fun isCoreRunning(generation: Long): Boolean? = withContext(Dispatchers.IO) {
        synchronized(coreLock) {
            if (!isCurrent(generation) || activeCoreGeneration != generation) null else XrayCore.isRunning
        }
    }


    // ------------------------------------------------------------------ network changes (signals only)
    private fun hasUnderlyingNetwork(): Boolean =
        runCatching { getSystemService(ConnectivityManager::class.java).activeNetwork != null }.getOrDefault(true)

    /**
     * The TUN interface survives Wi-Fi/mobile handoffs; Xray dials new connections over the new
     * default network (our package is excluded from the VPN). Callbacks therefore never rebuild the
     * tunnel: they update the underlying network and signal the session to VERIFY it.
     */
    private fun registerNetworkCallback() {
        if (networkCallback != null) return
        val cm = getSystemService(ConnectivityManager::class.java)
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                if (networkCallback !== this) return
                setUnderlyingNetworks(arrayOf(network))
                if (net.onAvailable(network) == NetworkTracker.Signal.VERIFY_TUNNEL) {
                    Log.i(TAG, "network restored/switched: asking the session to verify the tunnel")
                    wake.trySend(WAKE_NETWORK)
                }
            }

            override fun onLost(network: Network) {
                if (networkCallback !== this) return
                if (net.onLost(network) != NetworkTracker.Signal.WAIT_FOR_NETWORK) return
                val changed = synchronized(owner) {
                    if (VpnState.status.value.phase == Phase.CONNECTED) {
                        VpnState.update { it.copy(phase = Phase.RECONNECTING, detail = "در انتظار اینترنت…") }
                        true
                    } else false
                }
                Log.i(TAG, "underlying network lost: keeping TUN + core, waiting")
                if (changed) updateNotification("اینترنت قطع شد؛ در انتظار اتصال مجدد…")
            }

            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                if (networkCallback !== this) return
                val validated = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
                if (net.onValidated(network, validated) && validated) setUnderlyingNetworks(arrayOf(network))
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
    private fun shutdown(error: String?, code: String?, ownerGeneration: Long? = null): Job? {
        val job = synchronized(owner) {
            if (ownerGeneration != null && !owner.isCurrent(ownerGeneration)) return null
            val token = owner.next()
            sessionJob?.cancel()
            sessionJob = null
            net.reset()
            val callback = networkCallback
            networkCallback = null
            Log.i(TAG, "shutdown #$token: ${error ?: "user/system stop"}${code?.let { " [$it]" } ?: ""}")
            scope.launch(start = CoroutineStart.LAZY) {
                val last = withContext(Dispatchers.IO) {
                    synchronized(coreLock) {
                        if (!isCurrent(token)) {
                            null
                        } else {
                            val previous = synchronized(owner) { current }
                            stopCoreLocked()
                            owner.ifCurrent(token) { current = null; previous }
                        }
                    }
                }
                withContext(Dispatchers.Main.immediate) {
                    callback?.let {
                        runCatching { getSystemService(ConnectivityManager::class.java).unregisterNetworkCallback(it) }
                    }
                    if (!isCurrent(token)) return@withContext
                    if (last != null) scope.launch { Repository.api.event("disconnected", last.id) }
                    VpnState.set(VpnStatus(phase = Phase.DISCONNECTED, error = error, stopCode = code))
                    ServiceCompat.stopForeground(this@AppVpnService, ServiceCompat.STOP_FOREGROUND_REMOVE)
                    stopSelf()
                }
            }.also { cleanupJob = it }
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

    private fun notificationText(): String {
        val s = VpnState.status.value
        return if (s.phase == Phase.CONNECTED && s.configName != null) "متصل به ${s.configName}" else "در حال اتصال…"
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
