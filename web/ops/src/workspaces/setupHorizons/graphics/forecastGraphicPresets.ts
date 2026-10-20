export const FORECAST_GRAPHIC_PRESETS=[
 {width:1080,height:1080,primary:true,label:'Square'},
 {width:1080,height:1920,primary:true,label:'Story'},
 {width:1080,height:1350,primary:false,label:'Portrait'},
 {width:1200,height:630,primary:false,label:'Link card'},
 {width:1920,height:1080,primary:true,label:'Broadcast HD'},
 {width:3840,height:2160,primary:false,label:'Broadcast 4K'},
] as const

export type ForecastGraphicPreset=typeof FORECAST_GRAPHIC_PRESETS[number]
