package com.milad.vpn.vpn

import com.milad.vpn.data.ConfigBundle
import com.milad.vpn.data.VpnConfig
import com.milad.vpn.vpn.ServerSelector.Decision
import com.milad.vpn.vpn.ServerSelector.Impact
import com.milad.vpn.vpn.ServerSelector.Probe
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Numbering follows the required test list (1..17). */
class ServerSelectorTest {
    private fun ob(host: String) = """{"protocol":"vless","settings":{"vnext":[{"address":"$host","port":443}]}}"""
    private fun cfg(id: Long, priority: Int = 0, host: String = "h$id") = VpnConfig(id, "s$id", "DE", "vless", priority, ob(host))
    private fun p(c: VpnConfig, ms: Long?) = Probe(c, ms, if (ms == null) "timeout" else null)
    private fun bundle(version: String, vararg c: VpnConfig, sync: Int = 300) = ConfigBundle(c.toList(), version, sync)

    // 1
    @Test fun t01_autoChoosesLowestLatencyRegardlessOfPriority() {
        val probes = listOf(p(cfg(1, priority = 1), 900), p(cfg(2, priority = 99), 120), p(cfg(4, priority = 50), 300))
        assertEquals(listOf(2L, 4L, 1L), ServerSelector.rankByLatency(probes).map { it.config.id })
    }

    // 2
    @Test fun t02_previousServerGetsNoAdvantageWhenItMustReconnect() {
        val running = cfg(1)
        val probes = listOf(p(running, 100), p(cfg(2), 40))
        // running removed or changed -> pure latency order, no bias towards the previous id
        val d = ServerSelector.decide(running, Impact.CHANGED, probes) as Decision.Reconnect
        assertEquals(listOf(2L, 1L), d.candidates.map { it.id })
        // and a clearly better server beats a healthy running one
        assertTrue(ServerSelector.decide(running, Impact.NONE, listOf(p(running, 400), p(cfg(2), 100))) is Decision.Switch)
    }

    // 3
    @Test fun t03_changedCurrentConfigIsReRankedAgainstAllOthers() {
        val running = cfg(1, host = "old")
        val fresh = listOf(cfg(1, host = "new"), cfg(2), cfg(3))
        assertEquals(Impact.CHANGED, ServerSelector.impactOn(running, fresh))
        val probes = listOf(p(fresh[0], 300), p(fresh[1], 90), p(fresh[2], 200))
        val d = ServerSelector.decide(running, Impact.CHANGED, probes) as Decision.Reconnect
        assertEquals(listOf(2L, 3L, 1L), d.candidates.map { it.id })
        // the changed one may still win, but only on latency
        val d2 = ServerSelector.decide(running, Impact.CHANGED, listOf(p(fresh[0], 50), p(fresh[1], 90))) as Decision.Reconnect
        assertEquals(1L, d2.candidates.first().id)
        assertEquals(fresh[0].outbound, d2.candidates.first().outbound) // the NEW outbound is used
    }

    // 4
    @Test fun t04_newLowerLatencyConfigFromRefreshBecomesCandidate() {
        val running = cfg(1)
        val added = cfg(9)
        assertEquals(Impact.NONE, ServerSelector.impactOn(running, listOf(running, added)))
        val d = ServerSelector.decide(running, Impact.NONE, listOf(p(running, 300), p(added, 80)))
        assertEquals(9L, (d as Decision.Switch).target.id)
    }

    // 5
    @Test fun t05_removedCurrentConfigPicksLowestRemaining() {
        val running = cfg(1)
        val fresh = listOf(cfg(2), cfg(3))
        assertEquals(Impact.REMOVED, ServerSelector.impactOn(running, fresh))
        val d = ServerSelector.decide(running, Impact.REMOVED, listOf(p(fresh[0], 250), p(fresh[1], 70)))
        assertEquals(listOf(3L, 2L), (d as Decision.Reconnect).candidates.map { it.id })
    }

    // 6
    @Test fun t06_failedProbesAreNeverSelected() {
        assertTrue(ServerSelector.rankByLatency(listOf(p(cfg(1), null), Probe(cfg(2), -1, "x"), Probe(cfg(3), 0, null))).isEmpty())
        val running = cfg(1)
        // no measurement at all -> never switch on order/priority
        assertEquals(Decision.Keep, ServerSelector.decide(running, Impact.NONE, listOf(p(running, null), p(cfg(2, priority = -5), null))))
        // removed + nothing measurable -> reconnect with an EMPTY list (full pass), not a guess
        assertTrue((ServerSelector.decide(running, Impact.REMOVED, listOf(p(cfg(2), null))) as Decision.Reconnect).candidates.isEmpty())
    }

    // 7
    @Test fun t07_unchangedSubscriptionDoesNotTriggerReconnect() {
        val b = bundle("v1", cfg(1), cfg(2))
        assertFalse(ServerSelector.hasNewData("v1", b))
        assertEquals(Impact.NONE, ServerSelector.impactOn(cfg(1), b.configs))
        // key order of the outbound JSON is not a change
        assertTrue(ServerSelector.sameOutbound("""{"a":1,"b":{"c":[1,2]}}""", """{"b":{"c":[1,2]},"a":1}"""))
    }

    // 8
    @Test fun t08_successfulRefreshIsNewDataAndCarriesTheNewInterval() {
        val fresh = bundle("v2", cfg(1), cfg(5), sync = 300)
        assertTrue(ServerSelector.hasNewData("v1", fresh))
        assertTrue(ServerSelector.hasNewData(null, fresh))
        assertEquals(300_000L, ServerSelector.syncIntervalMs(fresh))
    }

    // 9
    @Test fun t09_transientBackendFailuresKeepTheTunnel() {
        for (code in listOf("NETWORK", "HTTP_500", "HTTP_502", "HTTP_504", "HTTP_429", null)) {
            assertEquals(code.toString(), ServerSelector.RefreshKind.TRANSIENT, ServerSelector.classifyRefreshError(code))
        }
        assertEquals(ServerSelector.RefreshKind.LOGGED_OUT, ServerSelector.classifyRefreshError("UNAUTHORIZED"))
        for (code in listOf("BLOCKED", "EXPIRED", "QUOTA_EXCEEDED", "NO_CONFIG")) {
            assertEquals(ServerSelector.RefreshKind.DENIED, ServerSelector.classifyRefreshError(code))
        }
    }

    // 10
    @Test fun t10_manualSelectionNeverFallsBackToAnotherLocation() {
        // Manual never goes through rankByLatency/decide; the only list it can use is "the selected id".
        val valid = ServerSelector.validConfigs(listOf(cfg(1), cfg(2), cfg(3)))
        val selected = 2L
        val manualCandidates = valid.filter { it.id == selected }
        assertEquals(listOf(2L), manualCandidates.map { it.id })
        // disappeared selection is detectable (-> explicit, persisted switch to Auto)
        assertTrue(ServerSelector.validConfigs(listOf(cfg(1), cfg(3))).none { it.id == selected })
    }

    // 11
    @Test fun t11_networkCallbacksOnlyProduceSignals() {
        val n = NetworkTracker<String>()
        assertEquals(NetworkTracker.Signal.NONE, n.onAvailable("wifi"))          // first registration
        assertEquals(NetworkTracker.Signal.VERIFY_TUNNEL, n.onAvailable("cell"))  // handoff -> verify, not rebuild
        assertEquals(NetworkTracker.Signal.NONE, n.onLost("wifi"))               // late loss of the old network
        assertTrue(n.available)
        assertEquals(NetworkTracker.Signal.WAIT_FOR_NETWORK, n.onLost("cell"))
        assertFalse(n.available)
        assertEquals(NetworkTracker.Signal.VERIFY_TUNNEL, n.onAvailable("cell"))
        assertFalse(n.onValidated("wifi", true))
        assertTrue(n.onValidated("cell", true)); assertTrue(n.validated)
    }

    // 12
    @Test fun t12_oneFailedHealthCheckDoesNotReconnect() {
        val h = ServerSelector.HealthTracker(3)
        assertFalse(h.failure())
        assertFalse(h.failure())
        h.success()
        assertFalse(h.failure())
    }

    // 13
    @Test fun t13_consecutiveGenuineTunnelFailuresCanReconnect() {
        val h = ServerSelector.HealthTracker(3)
        assertFalse(h.failure()); assertFalse(h.failure()); assertTrue(h.failure())
        assertEquals(ServerSelector.TunnelVerdict.TUNNEL_DOWN, ServerSelector.classifyTunnelFailure(networkValidated = true, backendReachable = false))
        assertEquals(ServerSelector.TunnelVerdict.TUNNEL_DOWN, ServerSelector.classifyTunnelFailure(networkValidated = false, backendReachable = true))
        // internet itself is down -> wait, do not reconnect
        assertEquals(ServerSelector.TunnelVerdict.NETWORK_DOWN, ServerSelector.classifyTunnelFailure(networkValidated = false, backendReachable = false))
    }

    // 14
    @Test fun t14_staleGenerationsCannotOverwriteTheActiveSession() {
        val o = SessionOwner()
        val old = o.next()
        val new = o.next()
        var state = "new"
        assertNull(o.ifCurrent(old) { state = "old"; true })
        assertEquals("new", state)
        assertEquals(true, o.ifCurrent(new) { state = "new2"; true })
        assertFalse(o.isCurrent(old)); assertTrue(o.isCurrent(new))
    }

    // 15
    @Test fun t15_repeatedRefreshesDoNotLoop() {
        val running = cfg(1)
        val b = bundle("v1", running, cfg(2))
        var known: String? = "v1"
        repeat(50) {
            if (ServerSelector.hasNewData(known, b)) known = b.version
            // even if re-ranked, the same measurements keep giving the same answer
            assertEquals(Decision.Keep, ServerSelector.decide(running, Impact.NONE, listOf(p(running, 100), p(cfg(2), 90))))
        }
        assertEquals("v1", known)
        val budget = ServerSelector.ReconnectBudget(max = 2, windowMs = 1000)
        assertTrue(budget.tryAcquire(0)); assertTrue(budget.tryAcquire(10)); assertFalse(budget.tryAcquire(20))
        assertTrue(budget.tryAcquire(1500))
    }

    // 16
    @Test fun t16_noOscillationOnNegligibleDifferences() {
        val a = cfg(1); val b = cfg(2)
        // jitter: A and B alternate being slightly faster -> never switch either way
        val samples = listOf(100L to 95L, 95L to 100L, 120L to 90L, 90L to 120L)
        for ((ma, mb) in samples) {
            assertEquals(Decision.Keep, ServerSelector.decide(a, Impact.NONE, listOf(p(a, ma), p(b, mb))))
            assertEquals(Decision.Keep, ServerSelector.decide(b, Impact.NONE, listOf(p(a, ma), p(b, mb))))
        }
        // threshold: max(50 ms, 25 %)
        assertFalse(ServerSelector.worthSwitching(800, 700)) // 100 < 200
        assertTrue(ServerSelector.worthSwitching(800, 600))  // 200 >= 200
        assertFalse(ServerSelector.worthSwitching(150, 110)) // 40 < 50
        assertTrue(ServerSelector.worthSwitching(150, 100))  // 50 >= 50
        // after a switch A->B, the reverse needs B to be clearly worse: no ping-pong
        assertEquals(Decision.Keep, ServerSelector.decide(b, Impact.NONE, listOf(p(a, 150), p(b, 120))))
    }

    // 17
    @Test fun t17_syncAfterSecondsIsRespected() {
        assertEquals(300_000L, ServerSelector.syncIntervalMs(bundle("v", cfg(1), sync = 300)))
        assertEquals(600_000L, ServerSelector.syncIntervalMs(bundle("v", cfg(1), sync = 600)))
        assertEquals(300_000L, ServerSelector.syncIntervalMs(null))                          // no cache -> contract default
        assertEquals(300_000L, ServerSelector.syncIntervalMs(bundle("v", cfg(1), sync = 0))) // missing -> contract default
        assertEquals(60_000L, ServerSelector.syncIntervalMs(bundle("v", cfg(1), sync = 5)))  // never a busy loop
    }

    @Test fun invalidOutboundsAreDropped() {
        val list = listOf(cfg(1), VpnConfig(2, "x", "", "", 0, "not json"), VpnConfig(3, "f", "", "", 0, """{"protocol":"freedom","settings":{}}"""), VpnConfig(4, "v", "", "", 0, """{"protocol":"vmess"}"""), cfg(1))
        assertEquals(listOf(1L), ServerSelector.validConfigs(list).map { it.id })
    }
}
