package com.mavrokinetic.mkdex;

import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.hardware.usb.UsbConfiguration;
import android.hardware.usb.UsbConstants;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbEndpoint;
import android.hardware.usb.UsbInterface;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.util.Base64;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Bridges Android's UsbManager to JS so Tango's WebUSB backend can talk ADB
 * to a phone plugged in over USB-C OTG. Android WebView has no WebUSB.
 */
@CapacitorPlugin(name = "MkUsb")
public class MkUsbPlugin extends Plugin {

    private static final String ACTION_PERMISSION = "com.mavrokinetic.mkdex.USB_PERMISSION";
    /** Android < 9 caps a single bulk transfer at 16 KiB. */
    private static final int MAX_CHUNK = 16384;

    private UsbManager usb;
    private final ExecutorService io = Executors.newCachedThreadPool();
    private final Map<Integer, UsbDeviceConnection> connections = new ConcurrentHashMap<>();
    private final Map<Integer, PluginCall> pendingPermission = new ConcurrentHashMap<>();

    private final BroadcastReceiver permissionReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            UsbDevice device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
            if (device == null) return;
            PluginCall call = pendingPermission.remove(device.getDeviceId());
            if (call == null) return;
            boolean granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false);
            JSObject ret = new JSObject();
            ret.put("granted", granted || usb.hasPermission(device));
            call.resolve(ret);
        }
    };

    private final BroadcastReceiver hotplugReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            UsbDevice device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
            if (device == null) return;
            JSObject ev = new JSObject();
            ev.put("deviceId", device.getDeviceId());
            if (UsbManager.ACTION_USB_DEVICE_DETACHED.equals(intent.getAction())) {
                UsbDeviceConnection c = connections.remove(device.getDeviceId());
                if (c != null) c.close();
                notifyListeners("detached", ev);
            } else {
                notifyListeners("attached", ev);
            }
        }
    };

    @Override
    public void load() {
        usb = (UsbManager) getContext().getSystemService(Context.USB_SERVICE);
        ContextCompat.registerReceiver(getContext(), permissionReceiver,
                new IntentFilter(ACTION_PERMISSION), ContextCompat.RECEIVER_NOT_EXPORTED);
        IntentFilter hotplug = new IntentFilter();
        hotplug.addAction(UsbManager.ACTION_USB_DEVICE_ATTACHED);
        hotplug.addAction(UsbManager.ACTION_USB_DEVICE_DETACHED);
        ContextCompat.registerReceiver(getContext(), hotplugReceiver, hotplug, ContextCompat.RECEIVER_EXPORTED);
    }

    @Override
    protected void handleOnDestroy() {
        try { getContext().unregisterReceiver(permissionReceiver); } catch (Exception ignored) { }
        try { getContext().unregisterReceiver(hotplugReceiver); } catch (Exception ignored) { }
        for (UsbDeviceConnection c : connections.values()) c.close();
        connections.clear();
        io.shutdownNow();
    }

    // ---------------------------------------------------------------- discovery

    @PluginMethod
    public void list(PluginCall call) {
        JSArray devices = new JSArray();
        for (UsbDevice d : usb.getDeviceList().values()) devices.put(describe(d));
        JSObject ret = new JSObject();
        ret.put("devices", devices);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        UsbDevice device = find(call);
        if (device == null) return;
        if (usb.hasPermission(device)) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? PendingIntent.FLAG_MUTABLE : 0;
        Intent intent = new Intent(ACTION_PERMISSION).setPackage(getContext().getPackageName());
        PendingIntent pi = PendingIntent.getBroadcast(getContext(), device.getDeviceId(), intent, flags);
        pendingPermission.put(device.getDeviceId(), call);
        usb.requestPermission(device, pi);
    }

    // ---------------------------------------------------------------- open / claim

    @PluginMethod
    public void open(PluginCall call) {
        UsbDevice device = find(call);
        if (device == null) return;
        if (connections.containsKey(device.getDeviceId())) { call.resolve(); return; }
        if (!usb.hasPermission(device)) { call.reject("No USB permission", "SecurityError"); return; }
        UsbDeviceConnection c = usb.openDevice(device);
        if (c == null) { call.reject("Could not open device", "NetworkError"); return; }
        connections.put(device.getDeviceId(), c);
        call.resolve();
    }

    @PluginMethod
    public void close(PluginCall call) {
        Integer id = call.getInt("deviceId");
        UsbDeviceConnection c = id == null ? null : connections.remove(id);
        if (c != null) c.close();
        call.resolve();
    }

    @PluginMethod
    public void claimInterface(PluginCall call) {
        UsbDevice device = find(call);
        UsbDeviceConnection c = connection(call);
        if (device == null || c == null) return;
        UsbInterface iface = findInterface(device, call.getInt("interfaceNumber", -1));
        if (iface == null) { call.reject("No such interface", "NotFoundError"); return; }
        if (!c.claimInterface(iface, true)) { call.reject("Interface busy", "NetworkError"); return; }
        call.resolve();
    }

    @PluginMethod
    public void releaseInterface(PluginCall call) {
        UsbDevice device = find(call);
        UsbDeviceConnection c = connection(call);
        if (device == null || c == null) return;
        UsbInterface iface = findInterface(device, call.getInt("interfaceNumber", -1));
        if (iface != null) c.releaseInterface(iface);
        call.resolve();
    }

    // ---------------------------------------------------------------- transfers

    @PluginMethod
    public void transferIn(PluginCall call) {
        UsbDevice device = find(call);
        UsbDeviceConnection c = connection(call);
        if (device == null || c == null) return;
        UsbEndpoint ep = findEndpoint(device, call.getInt("endpointNumber", -1), UsbConstants.USB_DIR_IN);
        if (ep == null) { call.reject("No such IN endpoint", "NotFoundError"); return; }
        int length = call.getInt("length", ep.getMaxPacketSize());

        io.execute(() -> {
            byte[] out = new byte[length];
            int total = 0;
            // Read until we have `length` bytes or the device ends the transfer with a short packet.
            while (total < length) {
                int want = Math.min(MAX_CHUNK, length - total);
                byte[] chunk = new byte[want];
                int n = c.bulkTransfer(ep, chunk, want, 0);
                if (n < 0) {
                    if (total > 0) break;
                    call.reject("transferIn failed", "NetworkError");
                    return;
                }
                System.arraycopy(chunk, 0, out, total, n);
                total += n;
                if (n < want) break;
            }
            JSObject ret = new JSObject();
            ret.put("data", Base64.encodeToString(out, 0, total, Base64.NO_WRAP));
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void transferOut(PluginCall call) {
        UsbDevice device = find(call);
        UsbDeviceConnection c = connection(call);
        if (device == null || c == null) return;
        UsbEndpoint ep = findEndpoint(device, call.getInt("endpointNumber", -1), UsbConstants.USB_DIR_OUT);
        if (ep == null) { call.reject("No such OUT endpoint", "NotFoundError"); return; }
        byte[] data = Base64.decode(call.getString("data", ""), Base64.DEFAULT);

        io.execute(() -> {
            int sent = 0;
            if (data.length == 0) {
                // Zero-length packet: marks end of a transfer that filled whole packets.
                int n = c.bulkTransfer(ep, data, 0, 5000);
                if (n < 0) { call.reject("transferOut failed", "NetworkError"); return; }
            }
            while (sent < data.length) {
                int want = Math.min(MAX_CHUNK, data.length - sent);
                int n = c.bulkTransfer(ep, data, sent, want, 5000);
                if (n < 0) { call.reject("transferOut failed", "NetworkError"); return; }
                sent += n;
            }
            JSObject ret = new JSObject();
            ret.put("bytesWritten", sent);
            call.resolve(ret);
        });
    }

    // ---------------------------------------------------------------- helpers

    private UsbDevice find(PluginCall call) {
        Integer id = call.getInt("deviceId");
        if (id != null) {
            for (UsbDevice d : usb.getDeviceList().values()) {
                if (d.getDeviceId() == id) return d;
            }
        }
        call.reject("Device not found", "NotFoundError");
        return null;
    }

    private UsbDeviceConnection connection(PluginCall call) {
        Integer id = call.getInt("deviceId");
        UsbDeviceConnection c = id == null ? null : connections.get(id);
        if (c == null) call.reject("Device not open", "InvalidStateError");
        return c;
    }

    private static UsbInterface findInterface(UsbDevice device, int number) {
        for (int i = 0; i < device.getInterfaceCount(); i++) {
            UsbInterface iface = device.getInterface(i);
            if (iface.getId() == number && iface.getAlternateSetting() == 0) return iface;
        }
        return null;
    }

    private static UsbEndpoint findEndpoint(UsbDevice device, int number, int direction) {
        for (int i = 0; i < device.getInterfaceCount(); i++) {
            UsbInterface iface = device.getInterface(i);
            for (int e = 0; e < iface.getEndpointCount(); e++) {
                UsbEndpoint ep = iface.getEndpoint(e);
                if (ep.getEndpointNumber() == number && ep.getDirection() == direction) return ep;
            }
        }
        return null;
    }

    private JSObject describe(UsbDevice d) {
        JSObject o = new JSObject();
        o.put("deviceId", d.getDeviceId());
        o.put("vendorId", d.getVendorId());
        o.put("productId", d.getProductId());
        o.put("productName", d.getProductName());
        o.put("manufacturerName", d.getManufacturerName());
        boolean perm = usb.hasPermission(d);
        o.put("hasPermission", perm);
        String serial = null;
        if (perm) {
            try { serial = d.getSerialNumber(); } catch (SecurityException ignored) { }
        }
        o.put("serialNumber", serial);

        JSArray configs = new JSArray();
        for (int ci = 0; ci < d.getConfigurationCount(); ci++) {
            UsbConfiguration cfg = d.getConfiguration(ci);
            // Group alternates under their interface number, like WebUSB does.
            Map<Integer, JSArray> alternates = new LinkedHashMap<>();
            for (int ii = 0; ii < cfg.getInterfaceCount(); ii++) {
                UsbInterface iface = cfg.getInterface(ii);
                JSObject alt = new JSObject();
                alt.put("alternateSetting", iface.getAlternateSetting());
                alt.put("interfaceClass", iface.getInterfaceClass());
                alt.put("interfaceSubclass", iface.getInterfaceSubclass());
                alt.put("interfaceProtocol", iface.getInterfaceProtocol());
                JSArray eps = new JSArray();
                for (int e = 0; e < iface.getEndpointCount(); e++) {
                    UsbEndpoint ep = iface.getEndpoint(e);
                    JSObject eo = new JSObject();
                    eo.put("endpointNumber", ep.getEndpointNumber());
                    eo.put("direction", ep.getDirection() == UsbConstants.USB_DIR_IN ? "in" : "out");
                    eo.put("packetSize", ep.getMaxPacketSize());
                    eo.put("type", ep.getType() == UsbConstants.USB_ENDPOINT_XFER_BULK ? "bulk"
                            : ep.getType() == UsbConstants.USB_ENDPOINT_XFER_INT ? "interrupt" : "isochronous");
                    eps.put(eo);
                }
                alt.put("endpoints", eps);
                alternates.computeIfAbsent(iface.getId(), k -> new JSArray()).put(alt);
            }
            JSArray ifaces = new JSArray();
            for (Map.Entry<Integer, JSArray> entry : alternates.entrySet()) {
                JSObject jo = new JSObject();
                jo.put("interfaceNumber", entry.getKey());
                jo.put("alternates", entry.getValue());
                ifaces.put(jo);
            }
            JSObject co = new JSObject();
            co.put("configurationValue", cfg.getId());
            co.put("interfaces", ifaces);
            configs.put(co);
        }
        o.put("configurations", configs);
        return o;
    }
}
