package com.selfwriting.app;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.List;
import java.util.Locale;

/**
 * selfwriting · 安卓外壳
 *
 * 界面本体是打包在 assets/www 里的离线网页应用（无联网功能）。
 * 这个壳只做三件事：
 *   1) 在本机回环地址上把 www 用 http 提供出来（WebView 用 file:// 时无法使用本地数据库）
 *   2) 用一个全屏 WebView 显示它
 *   3) 加载异常时给出不挡界面的提示与诊断入口
 *
 * 除访问本机回环地址所需的 INTERNET 外不申请任何权限。
 */
public class MainActivity extends Activity {

  private static final int PAPER = 0xFFF6F6F4;
  private static final int REQ_FILE_CHOOSER = 1001;

  private WebView web;
  private LocalServer server;
  private FrameLayout root;
  private LinearLayout banner;
  private TextView bannerText;
  private String baseUrl;
  private String lastWebError;
  private int healthyRounds = 0;
  private final Handler ui = new Handler(Looper.getMainLooper());

  /** WebView 里的 <input type="file"> 回调；点「选择文件」时用它接住结果 */
  private ValueCallback<Uri[]> filePathCallback;

  /** 原生读文件回调（网页调 SWNative.pickFile 时用） */
  private ValueCallback<Uri[]> nativeCallback;

  @Override
  protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    applyWindowStyle();

    server = new LocalServer(getAssets());
    int port = server.start();

    web = new WebView(this);
    web.setBackgroundColor(PAPER);
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);              // localStorage
    s.setDatabaseEnabled(true);                // IndexedDB 的前置条件
    s.setAllowFileAccess(false);
    // 必须允许内容访问：用户从系统文件选择器选的 txt/md 是 content:// URI，
    // 关掉它会导致选中文件后读不出内容（导入阅读/导入文本都依赖这个）
    s.setAllowContentAccess(true);
    s.setSupportZoom(false);
    s.setBuiltInZoomControls(false);
    s.setLoadWithOverviewMode(false);
    s.setUseWideViewPort(false);
    s.setDefaultTextEncodingName("utf-8");
    s.setMediaPlaybackRequiresUserGesture(true);
    s.setGeolocationEnabled(false);
    s.setJavaScriptCanOpenWindowsAutomatically(false);
    /*
     * 原生读文件通道。
     * 为什么必须在壳里读：用户从系统选择器拿到的是 content:// URI，WebView 的
     * FileReader 在部分机型/文件管理器上读不出内容（表现为「选了文件却说没能导入」）。
     * 这里用 ContentResolver 直接读成 base64 交给网页，绕开这一层不确定性。
     */
    web.addJavascriptInterface(new NativeBridge(), "SWNative");
    s.setSaveFormData(false);    // 注意：不要强制 LOAD_NO_CACHE。之前既禁缓存又收回环响应（Cache-Control: no-cache），
    // 在部分机型的 WebView 上会导致子资源（CSS/JS）加载失败，只剩一个无样式页面。
    // 资源随 APK 版本发布，用 WebView 默认缓存策略即可。

    CookieManager.getInstance().setAcceptCookie(true);

    web.setWebViewClient(new WebViewClient() {
      @Override
      public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        Uri u = request.getUrl();
        String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.US);
        if (scheme.equals("http") || scheme.equals("https")) {
          String host = u.getHost() == null ? "" : u.getHost();
          // 只允许本机资源；应用本身也不需要联网
          if (!host.equals("127.0.0.1") && !host.equals("localhost")) {
            return new WebResourceResponse("text/plain", "utf-8", 403, "Forbidden", null, null);
          }
        }
        return null;
      }

      @Override
      public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
        Uri u = request.getUrl();
        String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.US);
        if ("http".equals(scheme) || "https".equals(scheme)) {
          String host = u.getHost() == null ? "" : u.getHost();
          if (host.equals("127.0.0.1") || host.equals("localhost")) return false;
        }
        try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception e) { /* 忽略 */ }
        return true;
      }

      @Override
      public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
        if (request != null && request.isForMainFrame()) {
          lastWebError = "主页加载失败：" + (error == null ? "" : error.getDescription());
          showBanner("页面加载失败", lastWebError);
        }
      }

      @Override
      public void onPageFinished(WebView view, String url) {
        if (url == null || url.indexOf("index.html") < 0) return;
        // 注意：onPageFinished 只表示文档解析完，脚本可能还在执行。
        // 所以这里做多轮采样，只有连续多次都不健康才提示，避免误报挡住正常界面。
        healthyRounds = 0;
        ui.postDelayed(new Runnable() { @Override public void run() { sample(0); } }, 900);
      }
    });

    web.setWebChromeClient(new WebChromeClient() {
      @Override
      public void onPermissionRequest(PermissionRequest request) {
        request.deny();      // 不需要摄像头 / 麦克风
      }

      @Override
      public boolean onConsoleMessage(android.webkit.ConsoleMessage msg) {
        if (msg != null && msg.messageLevel() == android.webkit.ConsoleMessage.MessageLevel.ERROR) {
          lastWebError = msg.message() + " @" + msg.sourceId() + ":" + msg.lineNumber();
        }
        return false;
      }

      /**
       * 接管 <input type="file">。
       * 网页走的是原生通道（SWNative.pickFile），这里只是兜底：
       * 万一网页退回标准 input，也能正常选文件。
       */
      @Override
      public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                       FileChooserParams params) {
        if (filePathCallback != null) {
          filePathCallback.onReceiveValue(null);   // 上一次没接住，先释放，避免回调泄漏
        }
        filePathCallback = callback;
        openFilePicker();
        return true;
      }
    });

    try {
      WebStorage.getInstance().setQuotaForOrigin("http://127.0.0.1:" + port, 512L * 1024 * 1024);
    } catch (Throwable t) { /* 忽略 */ }

    root = new FrameLayout(this);
    root.addView(web, new FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    root.addView(buildBanner(), new FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM));
    setContentView(root);

    if (port <= 0) {
      showBanner("本地服务启动失败", "没有可用端口，请重启应用");
      return;
    }
    baseUrl = "http://127.0.0.1:" + port + "/index.html";
    web.loadUrl(baseUrl);
  }

  /* ---------------- 底部提示条（不遮挡界面） ---------------- */
  private View buildBanner() {
    banner = new LinearLayout(this);
    banner.setOrientation(LinearLayout.VERTICAL);
    banner.setBackgroundColor(0xFF2B2E33);
    int pad = dp(12);
    banner.setPadding(pad, pad, pad, pad);
    banner.setVisibility(View.GONE);

    bannerText = new TextView(this);
    bannerText.setTextColor(0xFFF2F2F0);
    bannerText.setTextSize(12);
    banner.addView(bannerText);

    LinearLayout row = new LinearLayout(this);
    row.setOrientation(LinearLayout.HORIZONTAL);
    row.setPadding(0, dp(8), 0, 0);
    row.addView(bannerButton("重试", new View.OnClickListener() {
      @Override public void onClick(View v) {
        hideBanner();
        if (web != null && baseUrl != null) web.loadUrl(baseUrl);
      }
    }));
    row.addView(bannerButton("诊断信息", new View.OnClickListener() {
      @Override public void onClick(View v) { showDiagnostics(); }
    }));
    row.addView(bannerButton("关闭", new View.OnClickListener() {
      @Override public void onClick(View v) { hideBanner(); }
    }));
    banner.addView(row);
    return banner;
  }

  private Button bannerButton(String text, View.OnClickListener l) {
    Button b = new Button(this);
    b.setText(text);
    b.setTextSize(12);
    b.setAllCaps(false);
    b.setOnClickListener(l);
    LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0,
        ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
    lp.rightMargin = dp(6);
    b.setLayoutParams(lp);
    return b;
  }

  private void showBanner(String title, String detail) {
    if (banner == null) return;
    bannerText.setText(title + (detail == null || detail.length() == 0 ? "" : "\n" + detail));
    banner.setVisibility(View.VISIBLE);
  }

  private void hideBanner() {
    if (banner != null) banner.setVisibility(View.GONE);
  }

  /**
   * 健康检查：样式生效且脚本已绑定 DOM，才算正常。
   * 连续 4 次（约 6 秒）都不正常才提示——设备慢时脚本可能还没跑完。
   */
  private void sample(final int round) {
    if (web == null) return;
    web.evaluateJavascript(
        "(function(){try{" +
        "  var styled = getComputedStyle(document.body).overflow === 'hidden';" +
        "  var bound  = !!(window.UI && window.Store && window.UI.dom && window.UI.dom.view);" +
        "  return (styled?'1':'0') + (bound?'1':'0');" +
        "}catch(e){ return '00'; }})()",
        new ValueCallback<String>() {
          @Override public void onReceiveValue(String value) {
            String v = value == null ? "" : value.replace("\"", "").trim();
            if (v.startsWith("11")) {
              healthyRounds++;
              if (healthyRounds >= 1) hideBanner();      // 恢复正常，撤掉提示
              return;
            }
            if (round < 3) {
              ui.postDelayed(new Runnable() { @Override public void run() { sample(round + 1); } }, 1800);
            } else {
              String why = "样式 " + (v.startsWith("1") ? "正常" : "未生效")
                  + "，脚本 " + (v.length() > 1 && v.charAt(1) == '1' ? "正常" : "未运行");
              if (lastWebError != null) why += "\n" + lastWebError;
              showBanner("应用资源未完整加载（" + why + "）", "可点「诊断信息」查看服务器请求记录");
            }
          }
        });
  }

  /** 诊断面板：显示服务器收到的请求与错误，便于定位问题 */
  private void showDiagnostics() {
    StringBuilder sb = new StringBuilder();
    sb.append("版本：1.1.1\n");
    sb.append("页面：").append(baseUrl == null ? "(未加载)" : baseUrl).append("\n");
    sb.append("最后错误：").append(lastWebError == null ? "无" : lastWebError).append("\n");
    sb.append("———— 服务器请求记录 ————\n");
    List<String> lines = server == null ? null : server.requestLog();
    if (lines == null || lines.isEmpty()) sb.append("(无)\n");
    else for (int i = 0; i < lines.size(); i++) sb.append(lines.get(i)).append("\n");

    ScrollView sc = new ScrollView(this);
    TextView tv = new TextView(this);
    tv.setText(sb.toString());
    tv.setTextSize(11);
    tv.setTextColor(0xFF1B1C1E);
    tv.setPadding(dp(14), dp(18), dp(14), dp(18));
    sc.addView(tv);
    sc.setBackgroundColor(PAPER);

    LinearLayout box = new LinearLayout(this);
    box.setOrientation(LinearLayout.VERTICAL);
    box.addView(sc, new LinearLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
    LinearLayout bar = new LinearLayout(this);
    bar.setPadding(dp(10), dp(8), dp(10), dp(10));
    bar.addView(bannerButton("返回应用", new View.OnClickListener() {
      @Override public void onClick(View v) { setContentView(root); }
    }));
    box.addView(bar);
    setContentView(box);
  }

  private int dp(int v) {
    return (int) (v * getResources().getDisplayMetrics().density);
  }

  /** 状态栏 / 导航栏与纸色背景统一（不依赖任何支持库） */
  private void applyWindowStyle() {
    try {
      Window w = getWindow();
      w.setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(PAPER));
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
        w.setStatusBarColor(PAPER);
        w.setNavigationBarColor(PAPER);
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        View decor = w.getDecorView();
        decor.setSystemUiVisibility(decor.getSystemUiVisibility() | 0x00002000);   // LIGHT_STATUS_BAR
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        View decor = w.getDecorView();
        decor.setSystemUiVisibility(decor.getSystemUiVisibility() | 0x00000010);   // LIGHT_NAVIGATION_BAR
      }
    } catch (Throwable t) { /* 个别机型不支持，忽略 */ }
  }

  @Override
  public void onBackPressed() {
    /* 返回键交给网页里的页面栈处理：先关弹层，再一层层往后退，
       到最外层时网页会提示「再按一次退出」并调用 SWNative.exitApp()。
       这样不会像浏览器那样把每一次跳转（换章、换标签）都回退一遍。 */
    if (web == null) {
      super.onBackPressed();
      return;
    }
    try {
      web.evaluateJavascript(
          "(function(){try{return (window.UI&&UI.hardwareBack)?String(UI.hardwareBack()):'false';}"
              + "catch(e){return 'false';}})()",
          new ValueCallback<String>() {
            @Override public void onReceiveValue(String value) {
              if (value == null || value.indexOf("true") < 0) {
                if (web != null && web.canGoBack()) web.goBack();
                else finish();
              }
            }
          });
    } catch (Throwable t) {
      if (web.canGoBack()) web.goBack();
      else super.onBackPressed();
    }
  }

  /** 文件选择器返回：把选中的 URI 交回网页（支持多选） */
  @Override
  protected void onActivityResult(int requestCode, int resultCode, Intent data) {
    if (requestCode != REQ_FILE_CHOOSER) {
      super.onActivityResult(requestCode, resultCode, data);
      return;
    }
    Uri[] result = null;
    if (resultCode == RESULT_OK && data != null) {
      /* 关键：把系统授予的读权限「持久化」下来。
         少了这一步，部分机型在回调结束后就无权读取 content:// 文件，
         WebView 再读会失败 —— 表现就是「选了文件却说没能导入」。 */
      int takeFlags = data.getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION
          | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
      try {
        if (takeFlags != 0) getContentResolver().takePersistableUriPermission(
            data.getData() != null ? data.getData() : data.getClipData().getItemAt(0).getUri(), takeFlags);
      } catch (Throwable t) { /* 多数机型不需要，失败也不影响 */ }

      if (data.getClipData() != null) {
        int n = data.getClipData().getItemCount();
        result = new Uri[n];
        for (int i = 0; i < n; i++) result[i] = data.getClipData().getItemAt(i).getUri();
      } else if (data.getData() != null) {
        result = new Uri[] { data.getData() };
      }
    }

    /* 原生通道：直接读字节交给网页（优先走这条） */
    if (nativeCallback != null) {
      nativeCallback.onReceiveValue(result);
      nativeCallback = null;
      return;
    }
    if (filePathCallback != null) {
      filePathCallback.onReceiveValue(result);
      filePathCallback = null;
    }
  }

  /* ================================================================== */
  /* 原生文件桥：让网页不依赖 WebView 的文件读取能力                      */
  /* ================================================================== */
  private class NativeBridge {

    /** 网页据此判断「有原生通道可用」 */
    @JavascriptInterface
    public boolean available() {
      return true;
    }

    /** 网页就绪握手：让壳知道脚本已经跑起来了 */
    @JavascriptInterface
    public void ready() {
      // 无需做事，网页侧据此确认通道存在
    }

    /**
     * 退出应用（网页在「再按一次返回键退出」确认后调用）。
     * 手机上从最近任务里划掉 == finish()，是用户预期的「退出」。
     */
    @JavascriptInterface
    public void exitApp() {
      ui.post(new Runnable() {
        @Override public void run() {
          finish();
        }
      });
    }

    /**
     * 网页请求：弹出文件选择器，并把选中文件的内容以 base64 交回。
     * 第二个参数 multiple 为 1 时允许多选（网页传多余参数是安全的）。
     */
    @JavascriptInterface
    public void pick(final String requestId, final int multiple) {
      ui.post(new Runnable() {
        @Override public void run() {
          nativeRequestId = requestId;
          if (nativeCallback != null) { nativeCallback.onReceiveValue(null); nativeCallback = null; }
          nativeCallback = new ValueCallback<Uri[]>() {
            @Override public void onReceiveValue(Uri[] uris) {
              deliverFiles(requestId, uris);
            }
          };
          openFilePicker(multiple == 1);
        }
      });
    }

    /** 兼容只传一个参数的调用 */
    @JavascriptInterface
    public void pick(final String requestId) {
      pick(requestId, 0);
    }

    /** 读一个小文件成 base64（避免大数据跨 JS 桥导致卡顿） */
    @JavascriptInterface
    public String readFile(String uriString) {
      try {
        Uri uri = Uri.parse(uriString);
        byte[] bytes = readAll(uri, 24 * 1024 * 1024);
        return Base64.encodeToString(bytes, Base64.NO_WRAP);
      } catch (Throwable t) {
        return null;
      }
    }
  }

  private String nativeRequestId;

  /** 打开系统文件选择器（原生通道与 WebView 通道共用） */
  private void openFilePicker() {
    openFilePicker(true);
  }

  private void openFilePicker(boolean multiple) {
    try {
      Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
      intent.addCategory(Intent.CATEGORY_OPENABLE);
      intent.setType("*/*");
      if (multiple) intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
      intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
      startActivityForResult(Intent.createChooser(intent, "选择文件"), REQ_FILE_CHOOSER);
    } catch (Throwable t) {
      try {
        Intent legacy = new Intent(Intent.ACTION_GET_CONTENT);
        legacy.addCategory(Intent.CATEGORY_OPENABLE);
        legacy.setType("*/*");
        if (multiple) legacy.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        legacy.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivityForResult(Intent.createChooser(legacy, "选择文件"), REQ_FILE_CHOOSER);
      } catch (Throwable t2) {
        // 两种方式都打不开：把原生回调立刻放掉，网页才能回退到标准 input
        if (nativeCallback != null) { nativeCallback.onReceiveValue(null); nativeCallback = null; }
        if (filePathCallback != null) { filePathCallback.onReceiveValue(null); filePathCallback = null; }
        showBanner("无法打开文件选择器", "这台设备没有可用的文件管理器，请改用「粘贴文本」导入");
      }
    }
  }

  /** 读成字节，带大小上限，避免误选巨大文件把内存撑爆 */
  private byte[] readAll(Uri uri, int limit) throws Exception {
    InputStream in = getContentResolver().openInputStream(uri);
    if (in == null) throw new Exception("打不开这个文件");
    try {
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      byte[] buf = new byte[64 * 1024];
      int n;
      while ((n = in.read(buf)) > 0) {
        out.write(buf, 0, n);
        if (out.size() > limit) throw new Exception("文件太大（超过 " + (limit / 1024 / 1024) + " MB）");
      }
      return out.toByteArray();
    } finally {
      try { in.close(); } catch (Throwable t) { /* 忽略 */ }
    }
  }

  /** 查询文件名与大小（不同的文件管理器给的列不一样，逐列兜底） */
  private String[] queryNameSize(Uri uri) {
    String name = null;
    long size = -1;
    Cursor c = null;
    try {
      c = getContentResolver().query(uri, null, null, null, null);
      if (c != null && c.moveToFirst()) {
        int ni = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
        if (ni >= 0) name = c.getString(ni);
        int si = c.getColumnIndex(OpenableColumns.SIZE);
        if (si >= 0 && !c.isNull(si)) size = c.getLong(si);
      }
    } catch (Throwable t) { /* 忽略，用兜底值 */ }
    finally { if (c != null) try { c.close(); } catch (Throwable t) { /* 忽略 */ } }
    if (name == null || name.length() == 0) {
      String last = uri.getLastPathSegment();
      name = (last == null || last.length() == 0) ? "导入的文件" : last;
    }
    return new String[] { name, String.valueOf(size) };
  }

  /** 把文件内容编码成 JSON 字符串（字段用 base64 包裹，避免转义地狱） */
  private void deliverFiles(String requestId, Uri[] uris) {
    StringBuilder sb = new StringBuilder();
    sb.append("{\"id\":").append(jsonStr(requestId)).append(",\"files\":[");
    boolean first = true;
    String err = null;
    if (uris != null) {
      for (Uri u : uris) {
        if (u == null) continue;
        try {
          byte[] bytes = readAll(u, 24 * 1024 * 1024);
          String[] ns = queryNameSize(u);
          String mime = getContentResolver().getType(u);
          if (!first) sb.append(',');
          first = false;
          sb.append("{\"name\":").append(jsonStr(ns[0]))
            .append(",\"size\":").append(ns[1])
            .append(",\"mime\":").append(jsonStr(mime == null ? "" : mime))
            .append(",\"b64\":").append(jsonStr(Base64.encodeToString(bytes, Base64.NO_WRAP)))
            .append('}');
        } catch (Throwable t) {
          err = String.valueOf(t.getMessage() == null ? t : t.getMessage());
        }
      }
    }
    sb.append(']');
    if (err != null) sb.append(",\"error\":").append(jsonStr(err));
    sb.append('}');
    callWeb("window.__swNativeFiles(" + sb + ")");
  }

  /** 调用网页里的回调（在主线程执行） */
  private void callWeb(final String js) {
    ui.post(new Runnable() {
      @Override public void run() {
        try { web.evaluateJavascript(js, null); } catch (Throwable t) { /* 忽略 */ }
      }
    });
  }

  /** 极简 JSON 字符串转义 */
  private static String jsonStr(String s) {
    if (s == null) return "null";
    StringBuilder b = new StringBuilder("\"");
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      switch (c) {
        case '"': b.append("\\\""); break;
        case '\\': b.append("\\\\"); break;
        case '\n': b.append("\\n"); break;
        case '\r': b.append("\\r"); break;
        case '\t': b.append("\\t"); break;
        default:
          if (c < 0x20) b.append(String.format("\\u%04x", (int) c));
          else b.append(c);
      }
    }
    return b.append('"').toString();
  }

  @Override
  protected void onPause() {
    super.onPause();
    if (web != null) web.onPause();
  }

  @Override
  protected void onResume() {
    super.onResume();
    if (web != null) web.onResume();
  }

  @Override
  protected void onDestroy() {
    if (server != null) server.stop();
    super.onDestroy();
  }
}
