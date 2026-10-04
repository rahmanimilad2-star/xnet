package com.milad.vpn.vpn

import org.json.JSONArray
import org.json.JSONObject

/**
 * Builds the full Xray-core JSON from the outbound the backend delivered.
 * The backend already validated & converted the share link; the app never handles raw links.
 */
object XrayConfigBuilder {
    const val TUN_MTU = 1500
    private val PRIVATE_CIDRS = listOf(
        "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "127.0.0.0/8", "169.254.0.0/16", "fc00::/7", "fe80::/10", "::1/128",
    )

    fun build(outboundJson: String, dnsServers: List<String> = listOf("1.1.1.1", "8.8.8.8")): String {
        val proxy = JSONObject(outboundJson).put("tag", "proxy")
        // keep connections alive across short network blips
        proxy.optJSONObject("streamSettings")?.let { ss ->
            val sockopt = ss.optJSONObject("sockopt") ?: JSONObject()
            sockopt.put("tcpKeepAliveInterval", 30)
            ss.put("sockopt", sockopt)
        }

        val root = JSONObject()
        root.put("log", JSONObject().put("loglevel", "warning"))
        root.put("stats", JSONObject())
        root.put(
            "policy", JSONObject()
                .put("levels", JSONObject().put("0", JSONObject().put("statsUserUplink", false).put("statsUserDownlink", false)))
                .put("system", JSONObject().put("statsOutboundUplink", true).put("statsOutboundDownlink", true)),
        )
        root.put("dns", JSONObject().put("servers", JSONArray(dnsServers)).put("queryStrategy", "UseIP"))

        // TUN inbound: the core reads packets from the VpnService file descriptor passed to startLoop().
        val tun = JSONObject()
            .put("tag", "tun-in")
            .put("protocol", "tun")
            .put("settings", JSONObject().put("name", "xray0").put("MTU", TUN_MTU))
            .put("sniffing", JSONObject().put("enabled", true).put("destOverride", JSONArray(listOf("http", "tls", "quic"))))
        root.put("inbounds", JSONArray().put(tun))

        root.put(
            "outbounds", JSONArray()
                .put(proxy)
                .put(JSONObject().put("tag", "direct").put("protocol", "freedom"))
                .put(JSONObject().put("tag", "block").put("protocol", "blackhole"))
                .put(JSONObject().put("tag", "dns-out").put("protocol", "dns")),
        )
        root.put(
            "routing", JSONObject().put("domainStrategy", "AsIs").put(
                "rules", JSONArray()
                    .put(JSONObject().put("type", "field").put("inboundTag", JSONArray(listOf("tun-in"))).put("port", "53").put("outboundTag", "dns-out"))
                    .put(JSONObject().put("type", "field").put("ip", JSONArray(PRIVATE_CIDRS)).put("outboundTag", "direct"))
                    .put(JSONObject().put("type", "field").put("network", "tcp,udp").put("outboundTag", "proxy")),
            ),
        )
        return root.toString()
    }
}
