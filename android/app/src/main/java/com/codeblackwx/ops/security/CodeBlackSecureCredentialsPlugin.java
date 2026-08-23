package com.codeblackwx.ops.security;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.SecureRandom;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

import org.json.JSONObject;

@CapacitorPlugin(name = "CodeBlackSecureCredentials")
public class CodeBlackSecureCredentialsPlugin extends Plugin {
    private static final String PREF_FILE = "CodeBlackSecureCredentials";
    private static final String KEY_ALIAS = "CodeBlackOpsCredentialKey";
    private static final int GCM_TAG_BITS = 128;
    private static final int IV_BYTES = 12;

    @PluginMethod
    public void setCredential(PluginCall call) {
        String key = normalizeKey(call.getString("key"));
        String value = call.getString("value", "");
        if (key == null) {
            call.reject("Unknown credential key.");
            return;
        }
        try {
            getPrefs().edit().putString(key, encrypt(value)).apply();
            call.resolve();
        } catch (Exception ex) {
            call.reject("Credential could not be stored securely.");
        }
    }

    @PluginMethod
    public void getCredential(PluginCall call) {
        String key = normalizeKey(call.getString("key"));
        if (key == null) {
            call.reject("Unknown credential key.");
            return;
        }
        JSObject result = new JSObject();
        String encrypted = getPrefs().getString(key, null);
        if (encrypted == null) {
            result.put("value", JSONObject.NULL);
            call.resolve(result);
            return;
        }
        try {
            result.put("value", decrypt(encrypted));
            call.resolve(result);
        } catch (Exception ex) {
            call.reject("Credential could not be read securely.");
        }
    }

    @PluginMethod
    public void deleteCredential(PluginCall call) {
        String key = normalizeKey(call.getString("key"));
        if (key == null) {
            call.reject("Unknown credential key.");
            return;
        }
        getPrefs().edit().remove(key).apply();
        call.resolve();
    }

    @PluginMethod
    public void hasCredential(PluginCall call) {
        String key = normalizeKey(call.getString("key"));
        if (key == null) {
            call.reject("Unknown credential key.");
            return;
        }
        JSObject result = new JSObject();
        result.put("value", getPrefs().contains(key));
        call.resolve(result);
    }

    private SharedPreferences getPrefs() {
        return getContext().getSharedPreferences(PREF_FILE, Context.MODE_PRIVATE);
    }

    private static String normalizeKey(String key) {
        if ("spotter-network.password".equals(key)) return key;
        if ("vehicle-node.command-token".equals(key)) return key;
        if ("live-overlay.station-token".equals(key)) return key;
        return null;
    }

    private static SecretKey getOrCreateKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) {
            return ((KeyStore.SecretKeyEntry) keyStore.getEntry(KEY_ALIAS, null)).getSecretKey();
        }

        KeyGenerator keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setRandomizedEncryptionRequired(true)
            .build();
        keyGenerator.init(spec);
        return keyGenerator.generateKey();
    }

    private static String encrypt(String value) throws Exception {
        byte[] iv = new byte[IV_BYTES];
        new SecureRandom().nextBytes(iv);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(GCM_TAG_BITS, iv));
        byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(iv, Base64.NO_WRAP) + "." + Base64.encodeToString(encrypted, Base64.NO_WRAP);
    }

    private static String decrypt(String value) throws Exception {
        String[] parts = value.split("\\.", 2);
        if (parts.length != 2) throw new IllegalArgumentException("Invalid credential envelope.");
        byte[] iv = Base64.decode(parts[0], Base64.NO_WRAP);
        byte[] encrypted = Base64.decode(parts[1], Base64.NO_WRAP);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(GCM_TAG_BITS, iv));
        return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
    }
}
