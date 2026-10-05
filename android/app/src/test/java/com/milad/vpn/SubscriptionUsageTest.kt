package com.milad.vpn

import com.milad.vpn.data.Account
import com.milad.vpn.ui.SubscriptionUsage
import com.milad.vpn.ui.SubscriptionUsage.Time
import com.milad.vpn.ui.SubscriptionUsage.Volume
import org.junit.Assert.assertEquals
import org.junit.Test

class SubscriptionUsageTest {
    private val GB = 1024L * 1024 * 1024
    private val DAY = 86_400_000L
    private val now = 1_800_000_000_000L
    private fun acc(quota: Long, used: Long, remaining: Long?, unlimited: Boolean = false, expires: Long? = null, known: Boolean = true) =
        Account("u", "ACTIVE", "", quota, unlimited, used, 0, used, remaining, expires, null, null, known)

    @Test fun limitedUsesBackendRemaining() {
        val v = SubscriptionUsage.volume(acc(50 * GB, 12 * GB, 38 * GB)) as Volume.Limited
        assertEquals(38 * GB, v.remainingBytes); assertEquals(50 * GB, v.quotaBytes); assertEquals(12 * GB, v.usedBytes)
        assertEquals(0.24f, v.usedFraction, 0.001f)
    }

    @Test fun missingRemainingFallsBackAndNeverNegative() {
        assertEquals(8 * GB, (SubscriptionUsage.volume(acc(10 * GB, 2 * GB, null)) as Volume.Limited).remainingBytes)
        val over = SubscriptionUsage.volume(acc(10 * GB, 12 * GB, null)) as Volume.Limited
        assertEquals(0L, over.remainingBytes); assertEquals(1f, over.usedFraction, 0f)
    }

    @Test fun unlimitedAndUnknown() {
        assertEquals(Volume.Unlimited(3 * GB), SubscriptionUsage.volume(acc(0, 3 * GB, null, unlimited = true)))
        assertEquals(Volume.Unknown, SubscriptionUsage.volume(acc(50 * GB, 0, 50 * GB, known = false)))
    }

    @Test fun daysLeftFromPanelExpiry() {
        assertEquals(Time.NoLimit, SubscriptionUsage.time(acc(0, 0, null, expires = null), now))
        assertEquals(Time.Expired, SubscriptionUsage.time(acc(0, 0, null, expires = now - 1), now))
        assertEquals(Time.Expired, SubscriptionUsage.time(acc(0, 0, null, expires = now), now))
        assertEquals(Time.DaysLeft(24), SubscriptionUsage.time(acc(0, 0, null, expires = now + 24 * DAY), now))
        assertEquals(Time.DaysLeft(1), SubscriptionUsage.time(acc(0, 0, null, expires = now + 3_600_000), now)) // same rule as backend ceil
    }
}
