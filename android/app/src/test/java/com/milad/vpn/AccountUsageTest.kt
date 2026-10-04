package com.milad.vpn

import com.milad.vpn.data.Account
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AccountUsageTest {
    private fun json(extra: String) = JSONObject(
        """{"username":"reza","status":"ACTIVE","status_message":"","quota_bytes":0,"unlimited":true,
            "used_bytes":0,"upload_bytes":0,"download_bytes":0,"remaining_bytes":null,"expires_at":null,
            "days_left":null,"usage_synced_at":null$extra}"""
    )

    @Test fun manualConfigUsageIsUnknownButActive() {
        val a = Account.from(json(""","usage_known":false"""))
        assertFalse(a.usageKnown)
        assertTrue("connect must stay enabled", a.isActive)
        assertEquals(null, a.remainingBytes)
    }

    @Test fun olderBackendsDefaultToKnown() {
        assertTrue(Account.from(json("")).usageKnown)
    }
}
