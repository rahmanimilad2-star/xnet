package com.milad.vpn.ui

import com.milad.vpn.data.Account
import kotlin.math.ceil

/**
 * Pure view-model for the Home "subscription usage" card.
 * Everything comes from the existing [Account] that the current refresh (/api/v1/configs, /api/v1/account)
 * already delivers: used_bytes, quota_bytes, remaining_bytes, unlimited, usage_known, expires_at, days_left.
 * Nothing is fetched or summed per config here.
 */
object SubscriptionUsage {
    private const val DAY_MS = 86_400_000L

    sealed interface Volume {
        /** Backend does not measure this user's traffic (usage_known = false). */
        object Unknown : Volume
        data class Unlimited(val usedBytes: Long) : Volume
        data class Limited(val usedBytes: Long, val quotaBytes: Long, val remainingBytes: Long) : Volume {
            val usedFraction: Float get() = if (quotaBytes <= 0) 0f else (usedBytes.toDouble() / quotaBytes).coerceIn(0.0, 1.0).toFloat()
        }
    }

    sealed interface Time {
        object NoLimit : Time
        object Expired : Time
        data class DaysLeft(val days: Int) : Time
    }

    fun volume(acc: Account): Volume = when {
        acc.unlimited || acc.quotaBytes <= 0 -> Volume.Unlimited(acc.usedBytes.coerceAtLeast(0))
        else -> Volume.Limited(
            usedBytes = acc.usedBytes.coerceAtLeast(0),
            quotaBytes = acc.quotaBytes,
            // the backend's own remaining_bytes; only if it is missing derive it from the same two fields
            remainingBytes = (acc.remainingBytes ?: (acc.quotaBytes - acc.usedBytes)).coerceAtLeast(0),
        )
    }

    /** Same rule as the backend's days_left: ceil((expires_at - now) / 1 day), based on the panel's expires_at. */
    fun time(acc: Account, now: Long = System.currentTimeMillis()): Time {
        val exp = acc.expiresAt ?: return Time.NoLimit
        if (exp <= now) return Time.Expired
        return Time.DaysLeft(ceil((exp - now).toDouble() / DAY_MS).toInt())
    }
}
