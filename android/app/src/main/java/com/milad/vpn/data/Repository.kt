package com.milad.vpn.data

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

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

    /** Latest account from ANY successful /api/v1/configs refresh (UI or VPN service). */
    private val _account = MutableStateFlow<Account?>(null)
    val account: StateFlow<Account?> = _account
    fun publishAccount(a: Account) { _account.value = a }

    fun logout() {
        session.clear()
        _account.value = null
    }
}
