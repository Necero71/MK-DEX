package com.mavrokinetic.mkdex;

import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * Raw TCP sockets for JS. The WebView can't open sockets, and ADB over Wi-Fi
 * is plain TCP to the phone's port 5555 (after `adb tcpip 5555`).
 *
 * connect → id, startReading → "data" events (base64), write, close → "closed".
 */
@CapacitorPlugin(name = "MkTcp")
public class MkTcpPlugin extends Plugin {

    private static final int READ_BUF = 64 * 1024;

    private final AtomicInteger nextId = new AtomicInteger(1);
    private final Map<Integer, Conn> conns = new ConcurrentHashMap<>();
    private final ExecutorService connectPool = Executors.newCachedThreadPool();

    private static final class Conn {
        final Socket socket;
        final OutputStream out;
        final InputStream in;
        /** Single writer thread keeps ADB packets in order. */
        final ExecutorService writer = Executors.newSingleThreadExecutor();
        volatile boolean closed;
        Thread reader;

        Conn(Socket s) throws IOException {
            socket = s;
            out = s.getOutputStream();
            in = s.getInputStream();
        }
    }

    @PluginMethod
    public void connect(PluginCall call) {
        String host = call.getString("host");
        Integer port = call.getInt("port", 5555);
        int timeout = call.getInt("timeoutMs", 5000);
        if (host == null || host.isEmpty()) {
            call.reject("host is required");
            return;
        }
        connectPool.execute(() -> {
            Socket s = new Socket();
            try {
                s.setTcpNoDelay(true);
                s.setKeepAlive(true);
                s.setReceiveBufferSize(1 << 20);
                s.setSendBufferSize(256 * 1024);
                s.connect(new InetSocketAddress(host, port), timeout);
                int id = nextId.getAndIncrement();
                conns.put(id, new Conn(s));
                JSObject ret = new JSObject();
                ret.put("id", id);
                call.resolve(ret);
            } catch (IOException e) {
                try { s.close(); } catch (IOException ignored) { }
                call.reject("Can't reach " + host + ":" + port + " — " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void startReading(PluginCall call) {
        int id = call.getInt("id", -1);
        Conn c = conns.get(id);
        if (c == null) {
            call.reject("No socket " + id);
            return;
        }
        if (c.reader == null) {
            c.reader = new Thread(() -> readLoop(id, c), "MkTcp-read-" + id);
            c.reader.start();
        }
        call.resolve();
    }

    private void readLoop(int id, Conn c) {
        byte[] buf = new byte[READ_BUF];
        String error = null;
        try {
            int n;
            while (!c.closed && (n = c.in.read(buf)) > 0) {
                JSObject e = new JSObject();
                e.put("id", id);
                e.put("data", Base64.encodeToString(buf, 0, n, Base64.NO_WRAP));
                notifyListeners("data", e);
            }
        } catch (IOException e) {
            if (!c.closed) error = e.getMessage() != null ? e.getMessage() : "connection lost";
        }
        shutdown(id, c);
        JSObject e = new JSObject();
        e.put("id", id);
        if (error != null) e.put("error", error);
        notifyListeners("closed", e);
    }

    @PluginMethod
    public void write(PluginCall call) {
        int id = call.getInt("id", -1);
        String data = call.getString("data", "");
        Conn c = conns.get(id);
        if (c == null || c.closed) {
            call.reject("Socket " + id + " is closed");
            return;
        }
        byte[] bytes = Base64.decode(data, Base64.NO_WRAP);
        c.writer.execute(() -> {
            try {
                c.out.write(bytes);
                c.out.flush();
                call.resolve();
            } catch (IOException e) {
                call.reject("Write failed: " + e.getMessage(), e);
            }
        });
    }

    @PluginMethod
    public void close(PluginCall call) {
        int id = call.getInt("id", -1);
        Conn c = conns.get(id);
        if (c != null) shutdown(id, c);
        call.resolve();
    }

    private void shutdown(int id, Conn c) {
        c.closed = true;
        conns.remove(id);
        c.writer.shutdown();
        try { c.socket.close(); } catch (IOException ignored) { }
    }

    @Override
    protected void handleOnDestroy() {
        for (Map.Entry<Integer, Conn> e : conns.entrySet()) shutdown(e.getKey(), e.getValue());
        connectPool.shutdownNow();
        super.handleOnDestroy();
    }
}
