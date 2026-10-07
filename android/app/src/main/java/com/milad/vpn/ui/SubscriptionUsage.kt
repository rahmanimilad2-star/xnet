package com.milad.vpn.ui

import com.milad.vpn.data.Account

object SubscriptionUsage {
    sealed interface Volume {
        object Unknown : Volume

        data class Unlimited(
            val usedBytes: Long
        ) : Volume

        data class Limited(
            val usedBytes: Long,
            val quotaBytes: Long,
            val remainingBytes: Long
        ) : Volume {
            val usedFraction: Float
                get() = if (quotaBytes <= 0) 0f
                else (usedBytes.toDouble() / quotaBytes)
                    .coerceIn(0.0, 1.0)
                    .toFloat()
        }
    }

    sealed interface Time {
        object NoLimit : Time
        object Expired : Time
        data class DaysLeft(val days: Int) : Time
    }

    fun volume(acc: Account): Volume {
        // Prefer the freshly fetched subscription_usage data.
        acc.subscriptionUsage?.let { u ->
            return if (u.unlimited) {
                Volume.Unlimited(u.usedBytes)
            } else {
                Volume.Limited(
                    usedBytes = u.usedBytes,
                    quotaBytes = u.totalBytes,
                    remainingBytes = u.remainingBytes ?: maxOf(0L, u.totalBytes - u.usedBytes)
                )
            }
        }

        // Normal account usage fallback.
        return when {
            !acc.usageKnown -> acc.subscriptionUserinfo?.let { u ->
                if (u.unlimited) {
                    Volume.Unlimited(u.usedBytes)
                } else {
                    u.remainingBytes?.let {
                        Volume.Limited(
                            usedBytes = u.usedBytes,
                            quotaBytes = u.totalBytes,
                            remainingBytes = it
                        )
                    }
                }
            } ?: Volume.Unknown

            acc.unlimited -> Volume.Unlimited(acc.usedBytes)

            else -> acc.remainingBytes?.let {
                Volume.Limited(
                    usedBytes = acc.usedBytes,
                    quotaBytes = acc.quotaBytes,
                    remainingBytes = it
                )
            } ?: Volume.Unknown
        }
    }

    fun time(acc: Account): Time {
        if (acc.expiresAt == null) {
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
