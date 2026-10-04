package com.milad.vpn.vpn

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

enum class Phase { DISCONNECTED, CONNECTING, CONNECTED, RECONNECTING }

data class VpnStatus(
    val phase: Phase = Phase.DISCONNECTED,
    val configId: Long? = null,
    val configName: String? = null,
    val upSpeed: Long = 0,      // bytes/s
    val downSpeed: Long = 0,
    val sessionUp: Long = 0,
    val sessionDown: Long = 0,
    val connectedSince: Long? = null,
    val pingMs: Long? = null,
    val error: String? = null,
    /** Server-side reason we stopped (QUOTA_EXCEEDED / EXPIRED / BLOCKED / NO_CONFIG / UNAUTHORIZED) */
    val stopCode: String? = null,
)

object VpnState {
    private val _status = MutableStateFlow(VpnStatus())
    val status: StateFlow<VpnStatus> = _status
    fun update(f: (VpnStatus) -> VpnStatus) { _status.value = f(_status.value) }
    fun set(s: VpnStatus) { _status.value = s }
}
