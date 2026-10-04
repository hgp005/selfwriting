package com.selfwriting.app;

import android.content.res.AssetManager;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URLDecoder;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 极简本地静态服务器。
 *
 * 为什么需要它：Android WebView 用 file:// 打开本地页面时无法使用 IndexedDB / localStorage，
 * 数据存不下来。用回环地址（127.0.0.1）以 http 提供应用资源，WebView 就拥有一个正常的来源，
 * 本地数据库、Service Worker 全部可用。
 *
 * 只监听 127.0.0.1（外部应用访问不到）。子资源请求不带查询串，
 * 因此这里不做令牌校验——安全由「只监听回环 + 壳里拒绝一切非本机请求」保证。
 *
 * 并发：WebView 会同时发起多个请求，所以每个连接都交给线程池处理，
 * 避免串行处理造成子资源加载超时。
 */
final class LocalServer {

  private static final String[] MIME = {
    ".html", "text/html; charset=utf-8",
    ".js", "text/javascript; charset=utf-8",
    ".mjs", "text/javascript; charset=utf-8",
    ".css", "text/css; charset=utf-8",
    ".json", "application/json; charset=utf-8",
    ".webmanifest", "application/manifest+json; charset=utf-8",
    ".svg", "image/svg+xml",
    ".png", "image/png",
    ".jpg", "image/jpeg",
    ".jpeg", "image/jpeg",
    ".webp", "image/webp",
    ".gif", "image/gif",
    ".ico", "image/x-icon",
    /* 音乐模块的采样音色：MIME 不对 WebView 会拒绝解码 */
    ".mp3", "audio/mpeg",
    ".m4a", "audio/mp4",
    ".ogg", "audio/ogg",
    ".wav", "audio/wav",
    ".woff", "font/woff",
    ".woff2", "font/woff2",
    ".ttf", "font/ttf",
    ".txt", "text/plain; charset=utf-8",
    ".md", "text/markdown; charset=utf-8"
  };

  private final AssetManager assets;
  private ServerSocket socket;
  private Thread thread;
  private ExecutorService pool;
  private volatile boolean running;
  int port;

  /** 请求日志（最近若干条），用于排查「资源加载不出来」这类问题 */
  private final List<String> log = Collections.synchronizedList(new ArrayList<String>());
  private static final int LOG_MAX = 60;

  LocalServer(AssetManager assets) {
    this.assets = assets;
  }

  List<String> requestLog() {
    synchronized (log) { return new ArrayList<String>(log); }
  }

  void clearLog() {
    synchronized (log) { log.clear(); }
  }

  private void note(String s) {
    synchronized (log) {
      log.add(s);
      while (log.size() > LOG_MAX) log.remove(0);
    }
  }

  /** 启动服务器，返回端口号；失败返回 -1 */
  int start() {
    for (int p = 8731; p <= 8760; p++) {
      try {
        ServerSocket s = new ServerSocket(p, 32, InetAddress.getByName("127.0.0.1"));
        socket = s;
        port = p;
        break;
      } catch (IOException e) {
        socket = null;
      }
    }
    if (socket == null) { note("启动失败：没有可用端口"); return -1; }

    pool = Executors.newFixedThreadPool(6);
    running = true;
    thread = new Thread(new Runnable() {
      @Override public void run() { loop(); }
    }, "selfwriting-http");
    thread.setDaemon(true);
    thread.start();
    note("监听 127.0.0.1:" + port);
    return port;
  }

  void stop() {
    running = false;
    try { if (socket != null) socket.close(); } catch (IOException e) { /* 忽略 */ }
    try { if (pool != null) pool.shutdownNow(); } catch (Throwable t) { /* 忽略 */ }
  }

  private void loop() {
    while (running) {
      final Socket client;
      try {
        client = socket.accept();
      } catch (IOException e) {
        if (running) continue;
        break;
      }
      try {
        pool.execute(new Runnable() {
          @Override public void run() {
            try {
              handle(client);
            } catch (Throwable t) {
              note("异常 " + t.getClass().getSimpleName() + ": " + t.getMessage());
            } finally {
              try { client.close(); } catch (IOException e) { /* 忽略 */ }
            }
          }
        });
      } catch (Throwable t) {
        // 线程池已关闭
        try { client.close(); } catch (IOException e) { /* 忽略 */ }
      }
    }
  }

  private void handle(Socket client) throws IOException {
    client.setSoTimeout(8000);
    InputStream in = client.getInputStream();

    String line = readLine(in, 4096);
    if (line == null || line.length() == 0) return;
    String[] parts = line.split(" ");
    String method = parts.length > 0 ? parts[0] : "GET";
    String rawPath = parts.length > 1 ? parts[1] : "/";
    String agent = "";
    int headerGuard = 0;
    while (headerGuard++ < 100) {
      String h = readLine(in, 4096);
      if (h == null || h.length() == 0) break;
      String lower = h.toLowerCase(Locale.US);
      if (lower.startsWith("user-agent:")) agent = h.substring(11).trim();
    }

    String query = "";
    int qi = rawPath.indexOf('?');
    if (qi >= 0) { query = rawPath.substring(qi + 1); rawPath = rawPath.substring(0, qi); }
    if (query.length() > 0) note("导航 " + rawPath + " (" + (agent.length() > 40 ? agent.substring(0, 40) : agent) + ")");

    String path;
    try {
      path = URLDecoder.decode(rawPath, "UTF-8");
    } catch (Exception e) {
      path = rawPath;
    }
    if (path.length() == 0 || path.equals("/")) path = "/index.html";
    if (path.indexOf("..") >= 0) { sendText(client, 403, "forbidden"); note("403 " + path); return; }

    /* 联网下载书籍：由壳代取，绕开网页跨域限制。
       只在用户主动点「下载」时才会被调用，地址由用户自己填。 */
    if (path.equals("/__fetch")) {
      handleFetch(client, query);
      return;
    }

    String assetPath = "www" + path;
    byte[] body = readAsset(assetPath);
    if (body == null && path.indexOf('.') < 0) {
      assetPath = "www/index.html";              // 单页应用回落
      body = readAsset(assetPath);
      path = "/index.html";
    }
    if (body == null) {
      sendText(client, 404, "not found");
      note("404 " + assetPath);
      return;
    }

    String mime = mimeOf(path);
    OutputStream out = client.getOutputStream();
    StringBuilder head = new StringBuilder();
    head.append("HTTP/1.1 200 OK\r\n");
    head.append("Content-Type: ").append(mime).append("\r\n");
    head.append("Content-Length: ").append(body.length).append("\r\n");
    // 不设置 Cache-Control：资源随 APK 版本发布，交给 WebView 默认缓存即可。
    // （之前既禁缓存又收回环响应，在部分机型的 WebView 上会让子资源加载失败）
    head.append("Connection: close\r\n\r\n");
    out.write(head.toString().getBytes("UTF-8"));
    if (!"HEAD".equalsIgnoreCase(method)) out.write(body);
    out.flush();
    note("200 " + path + "  " + body.length + "B  " + mime.split(";")[0]);
  }

  private byte[] readAsset(String path) {
    InputStream is = null;
    try {
      is = assets.open(path);
      ByteArrayOutputStream bos = new ByteArrayOutputStream(Math.max(1024, is.available()));
      byte[] buf = new byte[16384];
      int n;
      while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
      return bos.toByteArray();
    } catch (Throwable t) {
      note("读取失败 " + path + " : " + t.getClass().getSimpleName());
      return null;
    } finally {
      try { if (is != null) is.close(); } catch (IOException e) { /* 忽略 */ }
    }
  }

  private static String mimeOf(String path) {
    String p = path.toLowerCase(Locale.US);
    for (int i = 0; i < MIME.length; i += 2) {
      if (p.endsWith(MIME[i])) return MIME[i + 1];
    }
    return "application/octet-stream";
  }

  /* ================================================================== */
  /* 下载代理：/__fetch?url=<外部地址>                                   */
  /* ================================================================== */
  private static final int FETCH_LIMIT = 96 * 1024 * 1024;   // 单本最大 96 MB

  private void handleFetch(Socket client, String query) {
    String url = param(query, "url");
    if (url == null || url.length() == 0) {
      sendCors(client, 400, "text/plain; charset=utf-8", "缺少 url 参数".getBytes());
      return;
    }
    String lower = url.toLowerCase(Locale.US);
    if (!lower.startsWith("http://") && !lower.startsWith("https://")) {
      sendCors(client, 400, "text/plain; charset=utf-8", "只支持 http/https 地址".getBytes());
      note("fetch 拒绝非 http 地址");
      return;
    }
    java.net.HttpURLConnection conn = null;
    try {
      conn = (java.net.HttpURLConnection) new java.net.URL(url).openConnection();
      conn.setInstanceFollowRedirects(true);
      conn.setConnectTimeout(12000);
      conn.setReadTimeout(30000);
      conn.setRequestProperty("User-Agent", "selfwriting/1.6 (android)");
      conn.setRequestProperty("Accept", "*/*");
      int code = conn.getResponseCode();
      if (code < 200 || code >= 300) {
        sendCors(client, 502, "text/plain; charset=utf-8",
            ("对方服务器返回 " + code).getBytes("UTF-8"));
        note("fetch HTTP " + code + " " + shortUrl(url));
        return;
      }
      InputStream is = conn.getInputStream();
      ByteArrayOutputStream bos = new ByteArrayOutputStream(256 * 1024);
      byte[] buf = new byte[64 * 1024];
      int n;
      while ((n = is.read(buf)) > 0) {
        bos.write(buf, 0, n);
        if (bos.size() > FETCH_LIMIT) throw new IOException("文件超过 96 MB，已停止");
      }
      try { is.close(); } catch (Throwable t) { /* 忽略 */ }
      byte[] data = bos.toByteArray();
      sendCors(client, 200, mimeOf(url), data);
      note("fetch 200 " + data.length + "B  " + shortUrl(url));
    } catch (Throwable t) {
      String msg = t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage();
      try {
        sendCors(client, 502, "text/plain; charset=utf-8", ("下载失败：" + msg).getBytes("UTF-8"));
      } catch (Throwable t2) { /* 忽略 */ }
      note("fetch 失败 " + shortUrl(url) + " : " + msg);
    } finally {
      if (conn != null) try { conn.disconnect(); } catch (Throwable t) { /* 忽略 */ }
    }
  }

  private static String param(String query, String key) {
    if (query == null) return null;
    String[] parts = query.split("&");
    for (int i = 0; i < parts.length; i++) {
      int eq = parts[i].indexOf('=');
      if (eq <= 0) continue;
      if (!parts[i].substring(0, eq).equals(key)) continue;
      try {
        return URLDecoder.decode(parts[i].substring(eq + 1), "UTF-8");
      } catch (Exception e) {
        return parts[i].substring(eq + 1);
      }
    }
    return null;
  }

  private static String shortUrl(String u) {
    return u.length() > 70 ? u.substring(0, 70) + "..." : u;
  }

  /** 带跨域头的响应（网页从本机页面发起，必须放开） */
  private static void sendCors(Socket client, int code, String mime, byte[] body) {
    try {
      OutputStream out = client.getOutputStream();
      StringBuilder head = new StringBuilder();
      head.append("HTTP/1.1 ").append(code).append(" OK\r\n");
      head.append("Content-Type: ").append(mime).append("\r\n");
      head.append("Content-Length: ").append(body.length).append("\r\n");
      head.append("Access-Control-Allow-Origin: *\r\n");
      head.append("Cache-Control: no-store\r\n");
      head.append("Connection: close\r\n\r\n");
      out.write(head.toString().getBytes("UTF-8"));
      out.write(body);
      out.flush();
    } catch (IOException e) { /* 忽略 */ }
  }

  private static String readLine(InputStream in, int max) throws IOException {
    ByteArrayOutputStream buf = new ByteArrayOutputStream(128);
    int c;
    while ((c = in.read()) != -1) {
      if (c == '\n') break;
      if (c != '\r') buf.write(c);
      if (buf.size() > max) break;
    }
    if (c == -1 && buf.size() == 0) return null;
    return new String(buf.toByteArray(), "UTF-8");
  }

  private static void sendText(Socket client, int code, String text) {
    try {
      byte[] body = text.getBytes("UTF-8");
      OutputStream out = client.getOutputStream();
      String head = "HTTP/1.1 " + code + " \r\nContent-Type: text/plain; charset=utf-8\r\n"
          + "Content-Length: " + body.length + "\r\nConnection: close\r\n\r\n";
      out.write(head.getBytes("UTF-8"));
      out.write(body);
      out.flush();
    } catch (IOException e) { /* 忽略 */ }
  }
}
