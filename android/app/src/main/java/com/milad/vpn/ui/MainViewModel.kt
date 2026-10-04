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
    val account: Account? = null,
    val configs: List<VpnConfig> = Repository.session.loadConfigs()?.configs.orEmpty(),
    val selectedConfigId: Long = Repository.session.selectedConfigId,
    /** message for the subscription/config problem (quota, expiry, no config…) */
    val blockMessage: String? = null,
    val info: String? = null,
)

class MainViewModel(app: Application) : AndroidViewModel(app) {
    private val _ui = MutableStateFlow(UiState())
    val ui: StateFlow<UiState> = _ui
    val vpn = VpnState.status
    private var syncJob: Job? = null

    init { if (Repository.isLoggedIn) startSync() }

    fun login(username: String, password: String) {
        if (username.isBlank() || password.isBlank()) { _ui.value = _ui.value.copy(loginError = "نام کاربری و رمز عبور را وارد کنید"); return }
        _ui.value = _ui.value.copy(loading = true, loginError = null)
        viewModelScope.launch {
            try {
                val (token, acc) = Repository.api.login(username.trim(), password)
                Repository.session.token = token
                Repository.session.username = acc.username
                _ui.value = UiState(loggedIn = true, account = acc)
                startSync()
            } catch (e: ApiException) {
                _ui.value = _ui.value.copy(loading = false, loginError = e.message)
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

    private suspend fun refresh(): Int {
        try {
            val (acc, bundle) = Repository.api.configs()
            val oldVersion = Repository.session.loadConfigs()?.version
            Repository.session.saveConfigs(bundle)
            _ui.value = _ui.value.copy(account = acc, configs = bundle.configs, blockMessage = null, info = null)
            if (oldVersion != null && oldVersion != bundle.version && vpn.value.phase == Phase.CONNECTED) {
                AppVpnService.reload(getApplication()) // apply panel changes without app update
            }
            return bundle.syncAfterSeconds.coerceIn(30, 3600)
        } catch (e: ApiException) {
            when (e.code) {
                "UNAUTHORIZED" -> { logout(); }
                "NETWORK" -> _ui.value = _ui.value.copy(info = e.message)
                else -> {
                    // QUOTA_EXCEEDED / EXPIRED / BLOCKED / NO_CONFIG
                    val acc = e.account ?: runCatching { Repository.api.account() }.getOrNull()
                    _ui.value = _ui.value.copy(account = acc ?: _ui.value.account, configs = emptyList(), blockMessage = e.message)
                    if (vpn.value.phase != Phase.DISCONNECTED) AppVpnService.stop(getApplication())
                }
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
                    s.blockMessage != null -> _ui.value = s.copy(info = s.blockMessage)
                    s.configs.isEmpty() -> _ui.value = s.copy(info = "سرور فعالی برای حساب شما وجود ندارد.")
                    else -> startWithPermission()
                }
            }
            else -> AppVpnService.stop(getApplication())
        }
    }

    fun logout() {
        AppVpnService.stop(getApplication())
        syncJob?.cancel()
        Repository.logout()
        _ui.value = UiState(loggedIn = false, configs = emptyList())
    }
}
