package com.milad.vpn.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.milad.vpn.data.Account
import com.milad.vpn.data.ApiException
import com.milad.vpn.data.Repository
import com.milad.vpn.data.VpnConfig
import com.milad.vpn.vpn.AppVpnService
import com.milad.vpn.vpn.Phase
import com.milad.vpn.vpn.VpnState
import com.milad.vpn.vpn.VpnStatus
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

data class UiState(
    val loggedIn: Boolean = Repository.isLoggedIn,
    val loading: Boolean = false,
    val loginError: String? = null,
    val loginErrorCode: String? = null, // xnet-single-device-v1
    val account: Account? = null,
    val configs: List<VpnConfig> = Repository.session.loadConfigs()?.configs.orEmpty(),
    val subscriptionUsage: List<com.milad.vpn.data.SubscriptionItemUsage> = emptyList(),
    val supportTelegram: String = "@Xnetservice2",
    val selectedConfigId: Long = Repository.session.selectedConfigId,
    /** message for the subscription/config problem (quota, expiry, no config…) */
    val blockMessage: String? = null,
    /** backend code behind [blockMessage] (QUOTA_EXCEEDED / EXPIRED / BLOCKED / NO_CONFIG) */
    val blockCode: String? = null,
    val info: String? = null,
)

private val DENIAL_CODES = setOf("QUOTA_EXCEEDED", "EXPIRED", "BLOCKED", "NO_CONFIG")

class MainViewModel(app: Application) : AndroidViewModel(app) {
    private val _ui = MutableStateFlow(UiState())
    val ui: StateFlow<UiState> = _ui
    val vpn = VpnState.status
    private var syncJob: Job? = null
    private var manualRefreshJob: Job? = null

    init {
        if (Repository.isLoggedIn) startSync() else viewModelScope.launch { flushPendingRelease() }
        // the VPN service refreshes /api/v1/configs too (every sync_after_seconds); show its account data
        viewModelScope.launch { Repository.account.collect { a -> if (a != null && _ui.value.loggedIn) _ui.value = _ui.value.copy(account = a) } }
    }

    fun login(username: String, password: String) {
        if (username.isBlank() || password.isBlank()) { _ui.value = _ui.value.copy(loginError = "نام کاربری و رمز عبور را وارد کنید"); return }
        _ui.value = _ui.value.copy(loading = true, loginError = null, loginErrorCode = null)
        viewModelScope.launch {
            try {
                flushPendingRelease() // free this phone's previous session first, if a sign-out was offline
                val (token, acc) = Repository.api.login(username.trim(), password)
                Repository.session.token = token
                Repository.session.username = acc.username
                Repository.session.password = password
                _ui.value = UiState(loggedIn = true, account = acc)
                startSync()
            } catch (e: ApiException) {
                _ui.value = _ui.value.copy(loading = false, loginError = e.message, loginErrorCode = e.code)
            }
        }
    }

    /** Refresh account + configs now, then every sync_after_seconds (server-defined). */
    private fun startSync() {
        syncJob?.cancel()
        syncJob = viewModelScope.launch {
            while (isActive) {
                val wait = refresh()
                delay(wait * 1000L)
            }
        }
    }

    fun refreshNow() { viewModelScope.launch { refresh() } }

    /** Only the Account button triggers upstream subscription HTTP; periodic reads remain unchanged. */
    fun refreshAccountNow() {
        if (manualRefreshJob?.isActive == true) return
        manualRefreshJob = viewModelScope.launch {
            try {
                Repository.api.refreshSubscription()
                refresh()
            } catch (e: ApiException) {
                if (e.code == "UNAUTHORIZED") logout(releaseOnServer = false)
                else _ui.value = _ui.value.copy(info = e.message)
            }
        }
    }

    private suspend fun refresh(): Int {
        try {
            val (acc, bundle) = Repository.api.configs()
            val oldVersion = Repository.session.loadConfigs()?.version
            Repository.session.saveConfigs(bundle)
            Repository.publishAccount(acc)
            _ui.value = _ui.value.copy(
                account = acc,
                configs = bundle.configs,
                subscriptionUsage = bundle.subscriptionUsage,
                supportTelegram = bundle.supportTelegram,
                blockMessage = null,
                blockCode = null,
                info = null,
                // the service may have switched a removed manual location back to Auto
                selectedConfigId = Repository.session.selectedConfigId,
            )
            if (oldVersion != null && oldVersion != bundle.version && vpn.value.phase != Phase.DISCONNECTED) {
                // Only a signal: the service compares with the RUNNING config and reconnects only if it changed/was removed.
                runCatching { AppVpnService.reload(getApplication()) }
            }
            return bundle.syncAfterSeconds.coerceIn(30, 3600)
        } catch (e: ApiException) {
            when (e.code) {
                "UNAUTHORIZED" -> { logout(releaseOnServer = false) } // server already ended this session
                "NETWORK" -> _ui.value = _ui.value.copy(info = e.message)
                in DENIAL_CODES -> {
                    // QUOTA_EXCEEDED / EXPIRED / BLOCKED / NO_CONFIG
                    val acc = e.account ?: runCatching { Repository.api.account() }.getOrNull()
                    val msg = if (e.code == "QUOTA_EXCEEDED") e.message.ifBlank { VpnStatus.QUOTA_MESSAGE_FA } else e.message
                    _ui.value = _ui.value.copy(account = acc ?: _ui.value.account, configs = emptyList(), blockMessage = msg, blockCode = e.code)
                    if (vpn.value.phase != Phase.DISCONNECTED) AppVpnService.stop(getApplication())
                }
                // 5xx / proxy / unexpected answers are transient: never stop a working tunnel for them
                else -> _ui.value = _ui.value.copy(info = e.message)
            }
            return 60
        }
    }

    fun selectConfig(id: Long) {
        Repository.session.selectedConfigId = id
        _ui.value = _ui.value.copy(selectedConfigId = id)
        if (vpn.value.phase != Phase.DISCONNECTED) AppVpnService.reload(getApplication())
    }

    fun toggle(startWithPermission: () -> Unit) {
        when (vpn.value.phase) {
            Phase.DISCONNECTED -> {
                val s = _ui.value
                when {
                    s.blockMessage != null -> _ui.value = s.copy(info = if (s.blockCode == "QUOTA_EXCEEDED") VpnStatus.QUOTA_MESSAGE_FA else s.blockMessage)
                    s.configs.isEmpty() -> _ui.value = s.copy(info = "سرور فعالی برای حساب شما وجود ندارد.")
                    else -> startWithPermission()
                }
            }
            else -> AppVpnService.stop(getApplication())
        }
    }

    fun logout(releaseOnServer: Boolean = true) {
        val token = if (releaseOnServer) Repository.session.token else null
        AppVpnService.stop(getApplication())
        manualRefreshJob?.cancel()
        syncJob?.cancel()
        Repository.logout()
        _ui.value = UiState(loggedIn = false, configs = emptyList())
        if (token != null) {
            Repository.session.pendingRelease = token
            viewModelScope.launch { flushPendingRelease() }
        }
    }

    /** Tell the server this phone signed out, so the account can be used on another device. */
    private suspend fun flushPendingRelease() {
        val t = Repository.session.pendingRelease ?: return
        if (Repository.api.logout(t)) Repository.session.pendingRelease = null
    }
}
