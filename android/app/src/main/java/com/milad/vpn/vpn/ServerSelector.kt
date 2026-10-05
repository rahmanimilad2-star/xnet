package com.milad.vpn.vpn

import com.milad.vpn.data.ConfigBundle
import com.milad.vpn.data.VpnConfig
import org.json.JSONObject

/**
 * Pure connection policy (no Android, no native core) so every decision is unit-testable on the JVM.
 *
 * Auto   = every valid config is probed through its own temporary Xray instance
 *          (Libv2ray.measureOutboundDelay via XrayCore.probe) and ranked by that real latency only.
 *          Priority, list order, previous server and cached ping never influence the choice.
 *          Failed probes are never selected.
 * Manual = only the chosen config. No probing of others, no fallback, no silent switch to Auto.
 */
object ServerSelector {
    const val AUTO = -1L

    /** Backend contract: CONFIG_SYNC_SECONDS = 300. Used only if a bundle carries no value. */
    const val DEFAULT_SYNC_SECONDS = 300
    private const val MIN_SYNC_SECONDS = 60
    private const val MAX_SYNC_SECONDS = 3600

    /**
     * Anti-flap rule for a HEALTHY running Auto tunnel (and only there):
     * switch only if candidate <= current - max(MIN_SWITCH_GAIN_MS, current * MIN_SWITCH_GAIN_PERCENT / 100).
     * Why: a switch rebuilds the TUN and drops every open TCP connection of the user, and two
     * successive probes of the same server routinely differ by tens of ms on mobile networks.
     * 50 ms absolute ignores jitter-sized differences on fast links; 25 % relative ignores
     * e.g. 800 -> 700 ms on slow links. Both must be exceeded, so a switch is a real improvement.
     */
    const val MIN_SWITCH_GAIN_MS = 50L
    const val MIN_SWITCH_GAIN_PERCENT = 25L

    /** Outbound protocols that can never be a user's proxy server. */
    private val NOT_A_PROXY = setOf("freedom", "blackhole", "dns", "loopback")

    data class Probe(val config: VpnConfig, val delayMs: Long?, val error: String?) {
        val ok: Boolean get() = delayMs != null && delayMs > 0
    }

    // ------------------------------------------------------------------ validation + ranking
    /** Structural validation of the backend outbound (the backend already parsed the share link). */
    fun isValidOutbound(outbound: String): Boolean = runCatching {
        val o = JSONObject(outbound)
        val protocol = o.optString("protocol").trim().lowercase()
        protocol.isNotEmpty() && protocol !in NOT_A_PROXY && o.optJSONObject("settings") != null
    }.getOrDefault(false)

    fun validConfigs(all: List<VpnConfig>): List<VpnConfig> =
        all.filter { isValidOutbound(it.outbound) }.distinctBy { it.id }

    /**
     * Successful probes, lowest real latency first. Only an EXACT tie in ms falls back to id, purely
     * so the order is deterministic (it is not a preference).
     */
    fun rankByLatency(probes: List<Probe>): List<Probe> =
        probes.filter { it.ok }.sortedWith(compareBy<Probe>({ it.delayMs }, { it.config.id }))

    /** Short, real reason shown when no config answered its probe. */
    fun describeFailure(probes: List<Probe>): String {
        if (probes.isEmpty()) return "سرور فعالی برای حساب شما وجود ندارد."
        val first = probes.firstOrNull { !it.ok } ?: probes[0]
        val reason = first.error?.takeIf { it.isNotBlank() }?.take(120)
        return if (probes.size == 1) "سرور ${first.config.name} پاسخ نداد" + (reason?.let { " ($it)" } ?: "")
        else "هیچ‌کدام از ${probes.size} سرور پاسخ ندادند" + (reason?.let { " (${first.config.name}: $it)" } ?: "")
    }

    // ------------------------------------------------------------------ subscription refresh
    /** The server-provided interval (300 s today), clamped to a sane range, in ms. */
    fun syncIntervalMs(bundle: ConfigBundle?): Long {
        val s = bundle?.syncAfterSeconds?.takeIf { it > 0 } ?: DEFAULT_SYNC_SECONDS
        return s.coerceIn(MIN_SYNC_SECONDS, MAX_SYNC_SECONDS) * 1000L
    }

    /** New backend data = a version different from the one this tunnel was chosen with. */
    fun hasNewData(knownVersion: String?, fresh: ConfigBundle): Boolean = fresh.version != knownVersion

    enum class RefreshKind { LOGGED_OUT, DENIED, TRANSIENT }

    private val DENIAL_CODES = setOf("BLOCKED", "EXPIRED", "QUOTA_EXCEEDED", "NO_CONFIG")

    /** Existing app contract: UNAUTHORIZED logs out, explicit denials stop, everything else keeps the cache. */
    fun classifyRefreshError(code: String?): RefreshKind = when (code) {
        "UNAUTHORIZED" -> RefreshKind.LOGGED_OUT
        in DENIAL_CODES -> RefreshKind.DENIED
        else -> RefreshKind.TRANSIENT // NETWORK, timeout, HTTP_5xx, proxy errors, unexpected bodies
    }

    // ------------------------------------------------------------------ running config vs fresh list
    enum class Impact { NONE, CHANGED, REMOVED }

    fun impactOn(running: VpnConfig, fresh: List<VpnConfig>): Impact {
        val now = fresh.firstOrNull { it.id == running.id } ?: return Impact.REMOVED
        return if (sameOutbound(now.outbound, running.outbound)) Impact.NONE else Impact.CHANGED
    }

    /** Key-order independent JSON comparison. */
    fun sameOutbound(a: String, b: String): Boolean =
        a == b || runCatching { canonical(JSONObject(a)) == canonical(JSONObject(b)) }.getOrDefault(false)

    private fun canonical(v: Any?): String = when (v) {
        is JSONObject -> v.keys().asSequence().sorted().joinToString(",", "{", "}") { k -> "\"$k\":" + canonical(v.opt(k)) }
        is org.json.JSONArray -> (0 until v.length()).joinToString(",", "[", "]") { canonical(v.opt(it)) }
        is String -> JSONObject.quote(v)
        null, JSONObject.NULL -> "null"
        else -> v.toString()
    }

    // ------------------------------------------------------------------ Auto re-ranking decision
    sealed interface Decision {
        /** Keep the running tunnel untouched (no Xray restart, no TUN rebuild). */
        object Keep : Decision
        /** Running config was removed/changed: reconnect, candidates in pure latency order (no bias). */
        data class Reconnect(val candidates: List<VpnConfig>) : Decision
        /** Running config is healthy but measurably worse: switch once to [target]. */
        data class Switch(val target: VpnConfig, val gainMs: Long) : Decision
    }

    fun worthSwitching(currentMs: Long, candidateMs: Long): Boolean {
        val gain = currentMs - candidateMs
        return gain >= maxOf(MIN_SWITCH_GAIN_MS, currentMs * MIN_SWITCH_GAIN_PERCENT / 100)
    }

    /**
     * Among all valid Auto candidates (the running one included, with its CURRENT outbound),
     * which has the lowest successful real latency, and what does that mean for the tunnel?
     * - running removed or changed -> Reconnect in latency order; the running id gets no advantage.
     * - no successful measurement  -> Keep (never switch on priority/order).
     * - running is the best        -> Keep.
     * - running not measurable     -> Keep (cannot compare; deciding "dead" is the health monitor's job).
     * - otherwise                  -> Switch only if worthSwitching().
     */
    fun decide(running: VpnConfig, impact: Impact, probes: List<Probe>): Decision {
        val ranked = rankByLatency(probes)
        if (impact != Impact.NONE) return Decision.Reconnect(ranked.map { it.config })
        val best = ranked.firstOrNull() ?: return Decision.Keep
        if (best.config.id == running.id) return Decision.Keep
        val cur = probes.firstOrNull { it.config.id == running.id }
        val curMs = if (cur != null && cur.ok) cur.delayMs!! else return Decision.Keep
        val bestMs = best.delayMs!!
        return if (worthSwitching(curMs, bestMs)) Decision.Switch(best.config, curMs - bestMs) else Decision.Keep
    }

    // ------------------------------------------------------------------ health
    enum class TunnelVerdict { TUNNEL_DOWN, NETWORK_DOWN }

    /**
     * After N consecutive failed in-tunnel requests: is it the tunnel or the user's internet?
     * The network counts as usable if Android validated it OR our backend answered directly
     * (Android validation is often blocked in some regions, so either signal is enough).
     */
    fun classifyTunnelFailure(networkValidated: Boolean, backendReachable: Boolean): TunnelVerdict =
        if (networkValidated || backendReachable) TunnelVerdict.TUNNEL_DOWN else TunnelVerdict.NETWORK_DOWN

    /** Consecutive-failure counter: one failed sample never declares anything dead. */
    class HealthTracker(private val failuresToFail: Int) {
        var consecutiveFailures = 0
            private set
        fun success() { consecutiveFailures = 0 }
        /** @return true once [failuresToFail] consecutive failures happened. */
        fun failure(): Boolean = ++consecutiveFailures >= failuresToFail
    }

    /**
     * Final safety net for AUTOMATIC reconnects/switches. User actions are never counted.
     * Not a substitute for the deterministic rules above.
     */
    class ReconnectBudget(private val max: Int = 4, private val windowMs: Long = 10 * 60_000L) {
        private val stamps = ArrayDeque<Long>()
        fun reset() = stamps.clear()
        fun tryAcquire(now: Long): Boolean {
            while (stamps.isNotEmpty() && now - stamps.first() > windowMs) stamps.removeFirst()
            if (stamps.size >= max) return false
            stamps.addLast(now)
            return true
        }
    }
}

/** Generation-based ownership: exactly one session generation may change the connection. */
class SessionOwner {
    private var generation = 0L
    @Synchronized fun next(): Long = ++generation
    @Synchronized fun isCurrent(g: Long): Boolean = generation == g
    @Synchronized fun current(): Long = generation
    /** Runs [block] atomically only if [g] still owns the connection; null otherwise. */
    fun <T> ifCurrent(g: Long, block: () -> T): T? = synchronized(this) { if (generation == g) block() else null }
}

/**
 * Underlying-network bookkeeping. It only ever produces SIGNALS for the session owner;
 * it has no way to start, stop or rebuild a connection.
 */
class NetworkTracker<N : Any> {
    enum class Signal { NONE, VERIFY_TUNNEL, WAIT_FOR_NETWORK }

    private var current: N? = null
    @Volatile var available = true
        private set
    @Volatile var validated = false
        private set

    @Synchronized fun onAvailable(network: N): Signal {
        val previous = current
        val wasLost = !available
        current = network
        available = true
        if (previous != network) validated = false
        return if (wasLost || (previous != null && previous != network)) Signal.VERIFY_TUNNEL else Signal.NONE
    }

    @Synchronized fun onLost(network: N): Signal {
        // a late onLost for the previous network must not affect the newer one
        if (current != null && current != network) return Signal.NONE
        current = null
        available = false
        validated = false
        return Signal.WAIT_FOR_NETWORK
    }

    @Synchronized fun onValidated(network: N, isValidated: Boolean): Boolean {
        if (current != network) return false
        validated = isValidated
        return true
    }

    @Synchronized fun isCurrent(network: N): Boolean = current == network

    @Synchronized fun reset() { current = null; available = true; validated = false }
}
