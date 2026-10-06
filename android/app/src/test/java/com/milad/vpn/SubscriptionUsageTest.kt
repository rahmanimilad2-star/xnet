package com.milad.vpn

import com.milad.vpn.data.Account
import com.milad.vpn.data.SubscriptionUserinfo
import com.milad.vpn.ui.SubscriptionUsage
import com.milad.vpn.ui.SubscriptionUsage.Time
import com.milad.vpn.ui.SubscriptionUsage.Volume
import org.junit.Assert.assertEquals
import org.junit.Test

/** The Home card shows backend values as-is (no clock, no subtraction). */
class SubscriptionUsageTest {
    private val GB = 1024L * 1024 * 1024
    private fun acc(
        quota: Long = 50 * GB, used: Long = 0, remaining: Long? = null, unlimited: Boolean = false,
        expires: Long? = null, daysLeft: Int? = null, known: Boolean = true, status: String = "ACTIVE",
        info: SubscriptionUserinfo? = null,
    ) = Account("u", status, "", quota, unlimited, used, 0, used, remaining, expires, daysLeft, null, known, info)
    private fun info(used: Long, total: Long, remaining: Long?, unlimited: Boolean = false, expire: Long? = null, days: Int? = null) =
        SubscriptionUserinfo(used, total, unlimited, remaining, expire, days, 1L)

    @Test fun limitedShowsBackendRemaining() {
        val v = SubscriptionUsage.volume(acc(used = 12 * GB, remaining = 38 * GB)) as Volume.Limited
        assertEquals(38 * GB, v.remainingBytes); assertEquals(50 * GB, v.quotaBytes); assertEquals(12 * GB, v.usedBytes)
        assertEquals(0.24f, v.usedFraction, 0.001f)
    }

    @Test fun neverRecomputesRemaining() {
        // remaining_bytes missing for a limited plan -> not derived on the device
        assertEquals(Volume.Unknown, SubscriptionUsage.volume(acc(used = 2 * GB, remaining = null)))
    }

    @Test fun unlimitedAndUnknown() {
        assertEquals(Volume.Unlimited(3 * GB), SubscriptionUsage.volume(acc(quota = 0, used = 3 * GB, unlimited = true)))
        assertEquals(Volume.Unknown, SubscriptionUsage.volume(acc(remaining = 50 * GB, known = false)))
    }

    @Test fun daysComeFromBackendDaysLeft() {
        assertEquals(Time.NoLimit, SubscriptionUsage.time(acc(expires = null, daysLeft = null)))
        assertEquals(Time.DaysLeft(24), SubscriptionUsage.time(acc(expires = 1L, daysLeft = 24)))
        // expires_at is deliberately far in the past here: the device clock/expiry is NOT used
        assertEquals(Time.DaysLeft(1), SubscriptionUsage.time(acc(expires = 1L, daysLeft = 1)))
        assertEquals(Time.Expired, SubscriptionUsage.time(acc(expires = Long.MAX_VALUE, daysLeft = 0)))
        assertEquals(Time.Expired, SubscriptionUsage.time(acc(expires = Long.MAX_VALUE, daysLeft = 5, status = "EXPIRED")))
    }

    @Test fun subscriptionOnlyUsesBackendUserinfo() {
        val v = SubscriptionUsage.volume(acc(known = false, remaining = 50 * GB, info = info(4 * GB, 20 * GB, 16 * GB))) as Volume.Limited
        assertEquals(16 * GB, v.remainingBytes); assertEquals(20 * GB, v.quotaBytes); assertEquals(4 * GB, v.usedBytes)
        assertEquals(Volume.Unlimited(12), SubscriptionUsage.volume(acc(known = false, info = info(12, 0, null, unlimited = true))))
        // missing remaining is not derived locally
        assertEquals(Volume.Unknown, SubscriptionUsage.volume(acc(known = false, info = info(4, 20, null))))
        // measured users ignore it
        assertEquals(38 * GB, (SubscriptionUsage.volume(acc(used = 12 * GB, remaining = 38 * GB, info = info(1, 2, 1))) as Volume.Limited).remainingBytes)
    }

    @Test fun userinfoDaysOnlyWithoutPanelExpiry() {
        assertEquals(Time.DaysLeft(12), SubscriptionUsage.time(acc(known = false, info = info(0, 0, null, true, expire = 1L, days = 12))))
        assertEquals(Time.Expired, SubscriptionUsage.time(acc(known = false, info = info(0, 0, null, true, expire = 1L, days = 0))))
        // panel expiry wins
        assertEquals(Time.DaysLeft(30), SubscriptionUsage.time(acc(known = false, expires = 1L, daysLeft = 30, info = info(0, 0, null, true, expire = 1L, days = 2))))
        assertEquals(Time.NoLimit, SubscriptionUsage.time(acc(known = false, info = info(0, 0, null, true))))
    }
}
