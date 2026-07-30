package com.codeblackwx.ops.radar;

import java.util.Arrays;
import java.util.List;

class RadarSites {
    static List<RadarSite> defaultSites() {
        return Arrays.asList(
            new RadarSite("KSRX", "Fort Smith", "AR", 35.2904, -94.3619),
            new RadarSite("KINX", "Tulsa", "OK", 36.1751, -95.5643),
            new RadarSite("KTLX", "Oklahoma City", "OK", 35.3331, -97.2778),
            new RadarSite("KFDR", "Frederick", "OK", 34.3622, -98.9767),
            new RadarSite("KICT", "Wichita", "KS", 37.6544, -97.4431),
            new RadarSite("KTWX", "Topeka", "KS", 38.9969, -96.2326),
            new RadarSite("KEAX", "Kansas City", "MO", 38.8102, -94.2645),
            new RadarSite("KSGF", "Springfield", "MO", 37.2352, -93.4006),
            new RadarSite("KLZK", "Little Rock", "AR", 34.8365, -92.2622),
            new RadarSite("KSHV", "Shreveport", "LA", 32.4508, -93.8413),
            new RadarSite("KFWS", "Dallas/Fort Worth", "TX", 32.5728, -97.3031)
        );
    }
}
