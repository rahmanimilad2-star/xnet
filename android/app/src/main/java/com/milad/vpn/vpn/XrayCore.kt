package com.milad.vpn.vpn

import android.content.Context
import android.util.Log
import libv2ray.CoreCallbackHandler
import libv2ray.CoreController
import libv2ray.Libv2ray

/**
 * The ONLY place that talks to the native Xray core (AndroidLibXrayLite / libv2ray.aar v26.9.30).
 * Used API: Libv2ray.initCoreEnv / checkVersionX / newCoreController / measureOutboundDelay,
 * CoreController.startLoop / stopLoop / isRunning / measureDelay.
 */
object XrayCore {
    private const val TAG = "XrayCore"
    /** Same URL for ranking probes and in-tunnel checks, so the numbers are comparable. */
    const val DELAY_URL = "https://www.gstatic.com/generate_204"

    /** Written only inside the synchronized start/stop; read lock-free by measureDelay(). */
    @Volatile private var controller: CoreController? = null

    data class Delay(val ms: Long?, val error: String?)

    private val callback = object : CoreCallbackHandler {
        override fun startup(): Long { Log.i(TAG, "core started"); return 0 }
        override fun shutdown(): Long { Log.i(TAG, "core stopped"); return 0 }
        override fun onEmitStatus(code: Long, msg: String?): Long { Log.d(TAG, "status $code: $msg"); return 0 }
    }

    fun init(ctx: Context) {
        runCatching { Libv2ray.initCoreEnv(ctx.filesDir.absolutePath, "") }
            .onFailure { Log.e(TAG, "initCoreEnv failed", it) }
    }

    val version: String get() = runCatching { Libv2ray.checkVersionX() }.getOrDefault("?")

    val isRunning: Boolean get() = controller?.isRunning == true

    @Synchronized
    fun start(configJson: String, tunFd: Int) {
        stop()
        val c = Libv2ray.newCoreController(callback)
        c.startLoop(configJson, tunFd) // synchronous; throws on invalid config / start failure
        controller = c
    }

    @Synchronized
    fun stop() {
        controller?.let { runCatching { if (it.isRunning) it.stopLoop() } }
        controller = null
    }

    /**
     * Real HTTP round-trip through the RUNNING tunnel core (same routing the user's traffic takes).
     * Returns ms, or -1 on failure. Not synchronized on purpose: a slow probe must never block stop().
     */
    fun measureDelay(url: String = DELAY_URL): Long {
        val c = controller ?: return -1L
        return runCatching { c.measureDelay(url) }.getOrDefault(-1L)
    }

    /**
     * Latency of ONE config before connecting: a temporary Xray instance (no TUN, no inbound) dials
     * through exactly this outbound. Independent of the running core, safe to run in parallel.
     * Our package is excluded from the VPN, so probe sockets always use the real network.
     */
    fun probe(outboundJson: String, url: String = DELAY_URL): Delay = try {
        val ms = Libv2ray.measureOutboundDelay(XrayConfigBuilder.buildProbe(outboundJson), url)
        if (ms > 0) Delay(ms, null) else Delay(null, "بدون پاسخ")
    } catch (e: Exception) {
        Delay(null, e.message?.take(160) ?: "خطای نامشخص")
    }
}
