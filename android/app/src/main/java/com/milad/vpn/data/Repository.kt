package com.milad.vpn.data

import android.content.Context

/** Process-wide access to session + API (used by both UI and the VPN service). */
object Repository {
    lateinit var session: SessionStore
        private set
    lateinit var api: ApiClient
        private set

    fun init(ctx: Context) {
        session = SessionStore(ctx.applicationContext)
        api = ApiClient { session.token }
    }

    val isLoggedIn get() = session.token != null

    /** Ordered list to try: the selected server first (if any), then the rest by priority. */
    fun configsToTry(): List<VpnConfig> {
        val all = session.loadConfigs()?.configs.orEmpty().sortedBy { it.priority }
        val sel = session.selectedConfigId
        if (sel < 0) return all
        val chosen = all.firstOrNull { it.id == sel } ?: return all
        return listOf(chosen) + all.filter { it.id != sel }
    }

    fun logout() = session.clear()
}
