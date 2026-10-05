package com.milad.vpn.vpn

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VpnStatusTest {
    @Test fun quotaExhaustedIsNotAConnectionError() {
        val s = VpnStatus(phase = Phase.DISCONNECTED, error = "حجم اشتراک شما تمام شده است.", stopCode = "QUOTA_EXCEEDED")
        assertTrue(s.isQuotaExceeded)
        assertTrue(s.isServiceDenied)
        assertFalse(s.isError)
    }

    @Test fun realNetworkOrVpnFailureStaysAnError() {
        val s = VpnStatus(phase = Phase.DISCONNECTED, error = "اینترنت در دسترس نیست.", stopCode = null)
        assertTrue(s.isError)
        assertFalse(s.isQuotaExceeded)
    }

    @Test fun otherDenialsAreNotReportedAsQuota() {
        for (code in listOf("EXPIRED", "BLOCKED", "NO_CONFIG")) {
            val s = VpnStatus(phase = Phase.DISCONNECTED, error = "x", stopCode = code)
            assertFalse(code, s.isQuotaExceeded)
            assertFalse(code, s.isError)
        }
    }

    @Test fun cleanDisconnectIsNeitherErrorNorQuota() {
        val s = VpnStatus(phase = Phase.DISCONNECTED)
        assertFalse(s.isError); assertFalse(s.isQuotaExceeded)
    }

    @Test fun quotaTextMatchesBackend() {
        assertEquals("حجم اشتراک شما تمام شده است.", VpnStatus.QUOTA_MESSAGE_FA)
    }
}
