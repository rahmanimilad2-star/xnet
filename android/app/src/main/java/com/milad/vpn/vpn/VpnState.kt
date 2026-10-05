package com.milad.vpn.vpn

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

enum class Phase { DISCONNECTED, CONNECTING, CONNECTED, RECONNECTING }

data class VpnStatus(
    val phase: Phase = Phase.DISCONNECTED,
    val configId: Long? = null,
    val configName: String? = null,
    val connectedSince: Long? = null,
    val pingMs: Long? = null,
    val error: String? = null,
    /** Server-side reason we stopped (QUOTA_EXCEEDED / EXPIRED / BLOCKED / NO_CONFIG / UNAUTHORIZED) */
    val stopCode: String? = null,
    /** What the connection owner is doing right now (refreshing, measuring ping, waiting for internet…). */
    val detail: String? = null,
) {
    /** Backend said the data quota is used up (code QUOTA_EXCEEDED). Not a network/VPN error. */
    val isQuotaExceeded: Boolean get() = stopCode == "QUOTA_EXCEEDED"

    /** Stopped because the backend explicitly denied service (quota / expiry / blocked / no server). */
    val isServiceDenied: Boolean get() = stopCode in SERVICE_DENIAL_CODES

    /** ERROR = stopped because something technically failed (network, server, VPN), not a service denial. */
    val isError: Boolean get() = phase == Phase.DISCONNECTED && error != null && !isServiceDenied

    companion object {
        val SERVICE_DENIAL_CODES = setOf("QUOTA_EXCEEDED", "EXPIRED", "BLOCKED", "NO_CONFIG")
        /** Same text the backend sends (STATUS_MESSAGES.QUOTA_EXCEEDED); used if a message is missing. */
        const val QUOTA_MESSAGE_FA = "حجم اشتراک شما تمام شده است."
        const val QUOTA_MESSAGE_EN = "Your subscription data has run out."
    }
}

object VpnState {
    private val _status = MutableStateFlow(VpnStatus())
    val status: StateFlow<VpnStatus> = _status
    fun update(f: (VpnStatus) -> VpnStatus) { _status.value = f(_status.value) }
    fun set(s: VpnStatus) { _status.value = s }
}
