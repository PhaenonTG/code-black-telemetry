package com.codeblackwx.ops.radar;

import com.getcapacitor.JSObject;

class RadarSite {
    final String id;
    final String name;
    final String state;
    final double lat;
    final double lon;

    RadarSite(String id, String name, String state, double lat, double lon) {
        this.id = id;
        this.name = name;
        this.state = state;
        this.lat = lat;
        this.lon = lon;
    }

    JSObject toJson(Double distanceMi, String networkType) {
        JSObject object = new JSObject();
        object.put("id", id);
        object.put("name", name);
        object.put("state", state);
        object.put("lat", lat);
        object.put("lon", lon);
        if (distanceMi != null) object.put("distanceMi", Math.round(distanceMi * 10.0) / 10.0);
        object.put("networkType", networkType == null ? "NEXRAD" : networkType);
        return object;
    }
}
