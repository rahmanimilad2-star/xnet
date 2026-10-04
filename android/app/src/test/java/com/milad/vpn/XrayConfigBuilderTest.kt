package com.milad.vpn

import com.milad.vpn.vpn.XrayConfigBuilder
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class XrayConfigBuilderTest {
    private val outbound = """{"tag":"proxy","protocol":"vless","settings":{"vnext":[{"address":"1.2.3.4","port":443,"users":[{"id":"a3482e88-686a-4a58-8126-99c9df64b7bf","encryption":"none"}]}]},"streamSettings":{"network":"ws","security":"tls","wsSettings":{"path":"/ws"}}}"""

    @Test fun buildsFullConfig() {
        val j = JSONObject(XrayConfigBuilder.build(outbound))
        val inbounds = j.getJSONArray("inbounds")
        assertEquals(1, inbounds.length())
        assertEquals("tun", inbounds.getJSONObject(0).getString("protocol"))
        val outs = j.getJSONArray("outbounds")
        assertEquals("proxy", outs.getJSONObject(0).getString("tag"))
        assertEquals("vless", outs.getJSONObject(0).getString("protocol"))
        assertEquals(30, outs.getJSONObject(0).getJSONObject("streamSettings").getJSONObject("sockopt").getInt("tcpKeepAliveInterval"))
        assertTrue(j.getJSONObject("policy").getJSONObject("system").getBoolean("statsOutboundUplink"))
        val rules = j.getJSONObject("routing").getJSONArray("rules")
        assertEquals("dns-out", rules.getJSONObject(0).getString("outboundTag"))
        assertEquals("proxy", rules.getJSONObject(rules.length() - 1).getString("outboundTag"))
    }
}
