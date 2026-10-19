export const SHARE_FOOTER_HANDLE='@CodeBlackWX · codeblackwx.com'
export const SHARE_PRESETS=[
 {width:1080,height:1080,primary:true,label:'Square'},
 {width:1080,height:1920,primary:true,label:'Story'},
 {width:1080,height:1350,primary:false,label:'Portrait'},
 {width:1200,height:630,primary:false,label:'Link card'},
] as const
export type SharePreset=typeof SHARE_PRESETS[number]
