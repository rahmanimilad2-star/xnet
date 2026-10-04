package com.milad.vpn.vpn

import android.content.Context
import android.util.Log
import libv2ray.CoreCallbackHandler
import libv2ray.CoreController
import libv2ray.Libv2ray

/**
 * The ONLY place that talks to the native Xray core (AndroidLibXrayLite / libv2ray.aar).
 * Written against the CoreController API (AndroidLibXrayLite v25.x+). If your aar version
 * exposes different method names, adapt this file only.
 */
object XrayCore {
    private const val TAG = "XrayCore"
    private var controller: CoreController? = null

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
        c.startLoop(configJson, tunFd) // throws on invalid config / start failure
        controller = c
    }

    @Synchronized
    fun stop() {
        controller?.let { runCatching { if (it.isRunning) it.stopLoop() } }
        controller = null
    }

    /** Real HTTP round-trip through the running proxy; returns delay in ms or -1 on failure. */
    fun measureDelay(url: String = "https://www.gstatic.com/generate_204"): Long =
        runCatching { controller?.measureDelay(url) ?: -1L }.getOrDefault(-1L)

    /** Bytes since the previous call (Xray resets the counter on read). */
    fun queryStats(tag: String, direction: String): Long =
        runCatching { controller?.queryStats(tag, direction) ?: 0L }.getOrDefault(0L)
}
