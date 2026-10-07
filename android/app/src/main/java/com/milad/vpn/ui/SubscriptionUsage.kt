package com.milad.vpn.ui

import com.milad.vpn.data.Account

/**
 * Display mapping for the Home "subscription usage" card.
 * The backend is the only authority: used_bytes, quota_bytes, remaining_bytes, unlimited, usage_known,
 * expires_at, days_left and status come from /api/v1/configs (/api/v1/account) and are shown as-is.
 * For subscription-only users (usage_known = false) the backend may add account.subscription_userinfo
 * (display only, never status). No clock, no subtraction, no per-config sums here.
 */
object SubscriptionUsage {

    sealed interface Volume {
        /** Backend does not measure this user's traffic (usage_known = false) or sent no remaining value. */
        object Unknown : Volume
        data class Unlimited(val usedBytes: Long) : Volume
        data class Limited(val usedBytes: Long, val quotaBytes: Long, val remainingBytes: Long) : Volume {
            /** Only for the progress bar width. */
            val usedFraction: Float get() = if (quotaBytes <= 0) 0f else (usedBytes.toDouble() / quotaBytes).coerceIn(0.0, 1.0).toFloat()
        }
    }

    sealed interface Time {
        object NoLimit : Time
        object Expired : Time
        data class DaysLeft(val days: Int) : Time
    }

    fun volume(acc: Account): Volume = when {
        // Panel doesn't measure this user: show the backend's upstream Subscription-Userinfo values if it sent them.
        !acc.usageKnown -> acc.subscriptionUserinfo?.let { u ->
            if (u.unlimited) Volume.Unlimited(u.usedBytes)
            else u.remainingBytes?.let { Volume.Limited(u.usedBytes, u.totalBytes, it) }
        } ?: Volume.Unknown
        acc.unlimited -> Volume.Unlimited(acc.usedBytes)
        else -> acc.remainingBytes?.let { Volume.Limited(acc.usedBytes, acc.quotaBytes, it) } ?: Volume.Unknown
    }

    /** From the backend's expires_at / days_left / status. days_left is max(0, ceil(...)) on the server, so 0 = expired. */
    fun time(acc: Account): Time {
        if (acc.expiresAt == null) {
            // No panel expiry: an unmeasured (subscription-only) user may still have the backend's upstream days_left.
            val u = acc.subscriptionUserinfo ?: return Time.NoLimit
            val d = u.daysLeft
            return when {
                acc.usageKnown || u.expireAt == null || d == null -> Time.NoLimit
                d == 0 -> Time.Expired
                else -> Time.DaysLeft(d)
            }
        }
        val d = acc.daysLeft
        return when {
            acc.status == "EXPIRED" || d == 0 -> Time.Expired
            d == null -> Time.NoLimit
            else -> Time.DaysLeft(d)
        }
    }
}
