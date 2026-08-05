/**
 * The projected view, as a self-contained HTML page.
 *
 * Deliberately imports nothing. An earlier version bundled a TypeScript client with
 * `Bun.build` so it could call the engine's `flatten` directly, which worked in development
 * and then failed in the compiled binary — source files live in Bun's virtual `$bunfs` at
 * that point and cannot be read back. Since the daemon already holds the engine, it
 * flattens server-side and sends plain polylines instead. That removes the build step, and
 * makes it impossible for the projected geometry to drift from the recorded geometry,
 * because the projector no longer knows what geometry is.
 */
export const projectorPage = (): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>jarvis projector</title>
<style>
  :root { color-scheme: dark }
  * { margin: 0; padding: 0; box-sizing: border-box }
  html, body { width: 100%; height: 100%; overflow: hidden; background: #04100e; cursor: none }
  canvas { display: block }
  #status {
    position: fixed; left: 18px; bottom: 14px;
    font: 14px ui-monospace, SFMono-Regular, Menlo, monospace;
    color: rgba(148, 214, 200, 0.72); letter-spacing: 0.02em;
  }
  #tool {
    position: fixed; right: 18px; bottom: 14px;
    font: 14px ui-monospace, SFMono-Regular, Menlo, monospace;
    color: rgba(94, 234, 212, 0.9); letter-spacing: 0.08em; text-transform: uppercase;
  }
</style>
</head>
<body>
<canvas id="sheet"></canvas>
<div id="status">starting…</div>
<div id="tool"></div>
<script>
(function () {
  var canvas = document.getElementById("sheet");
  var ctx = canvas.getContext("2d");
  var statusEl = document.getElementById("status");
  var toolEl = document.getElementById("tool");

  // Everything the server sends. No geometry is computed here.
  var scene = { viewBox: [0, 0, 297, 210], shapes: [], labels: [] };
  var stroke = [];
  var cursor = null;
  var marker = null;
  var statusText = "starting…";

  function resize() {
    var ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(window.innerWidth * ratio);
    canvas.height = Math.round(window.innerHeight * ratio);
    canvas.style.width = window.innerWidth + "px";
    canvas.style.height = window.innerHeight + "px";
    draw();
  }

  function view() {
    var vb = scene.viewBox;
    var ratio = window.devicePixelRatio || 1;
    var w = canvas.width / ratio;
    var h = canvas.height / ratio;
    var scale = Math.min(w / (vb[2] || 1), h / (vb[3] || 1)) * 0.94;
    var ox = (w - vb[2] * scale) / 2 - vb[0] * scale;
    var oy = (h - vb[3] * scale) / 2 - vb[1] * scale;
    return { scale: scale, x: ox, y: oy };
  }

  function draw() {
    var ratio = window.devicePixelRatio || 1;
    var v = view();
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    var vb = scene.viewBox;
    ctx.strokeStyle = "rgba(120, 180, 170, 0.3)";
    ctx.lineWidth = 2;
    ctx.strokeRect(v.x + vb[0] * v.scale, v.y + vb[1] * v.scale, vb[2] * v.scale, vb[3] * v.scale);

    for (var i = 0; i < scene.shapes.length; i++) {
      var shape = scene.shapes[i];
      ctx.strokeStyle = shape.color || "#e7f6f2";
      ctx.lineWidth = Math.max(1.5, (shape.width || 0.4) * v.scale);
      ctx.setLineDash(shape.dash === "dashed" ? [7, 4] : shape.dash === "dotted" ? [2, 4] : []);
      ctx.beginPath();
      for (var r = 0; r < shape.runs.length; r++) {
        var run = shape.runs[r];
        for (var p = 0; p < run.length; p += 2) {
          var sx = v.x + run[p] * v.scale;
          var sy = v.y + run[p + 1] * v.scale;
          if (p === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
        }
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);

    for (var l = 0; l < scene.labels.length; l++) {
      var label = scene.labels[l];
      ctx.save();
      ctx.fillStyle = label.color || "#e7f6f2";
      ctx.font = Math.max(10, (label.size || 4) * v.scale) + "px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = label.align || "left";
      ctx.translate(v.x + label.at[0] * v.scale, v.y + label.at[1] * v.scale);
      if (label.angle) ctx.rotate((label.angle * Math.PI) / 180);
      ctx.fillText(label.text, 0, 0);
      ctx.restore();
    }

    if (stroke.length >= 4) {
      ctx.strokeStyle = "#5eead4";
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (var s = 0; s < stroke.length; s += 2) {
        var px = v.x + stroke[s] * v.scale;
        var py = v.y + stroke[s + 1] * v.scale;
        if (s === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }

    if (cursor) {
      ctx.beginPath();
      ctx.arc(v.x + cursor[0] * v.scale, v.y + cursor[1] * v.scale, stroke.length ? 7 : 11, 0, Math.PI * 2);
      ctx.strokeStyle = stroke.length ? "#5eead4" : "rgba(94, 234, 212, 0.55)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    if (marker) {
      var mx = v.x + marker.target[0] * v.scale;
      var my = v.y + marker.target[1] * v.scale;
      ctx.strokeStyle = "#fbbf24";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(mx, my, 26, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(mx - 44, my); ctx.lineTo(mx + 44, my);
      ctx.moveTo(mx, my - 44); ctx.lineTo(mx, my + 44);
      ctx.stroke();
      ctx.fillStyle = "#fbbf24";
      ctx.font = "20px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("touch the marker  " + (marker.index + 1) + "/" + marker.total, mx, my + 62);
    }

    statusEl.textContent = statusText;
  }

  function connect() {
    var socket = new WebSocket("ws://" + location.host + "/live");
    socket.onmessage = function (event) {
      var message = JSON.parse(event.data);
      if (message.type === "scene") scene = message.scene;
      else if (message.type === "stroke") stroke = message.points;
      else if (message.type === "cursor") cursor = message.at;
      else if (message.type === "tool") toolEl.textContent = message.tool;
      else if (message.type === "status") statusText = message.text;
      else if (message.type === "calibrate") marker = message;
      else if (message.type === "calibrate-done") marker = null;
      draw();
    };
    socket.onclose = function () {
      statusText = "reconnecting…";
      draw();
      // The daemon restarting must not leave a dead view on the wall.
      setTimeout(connect, 1000);
    };
  }

  window.addEventListener("resize", resize);
  resize();
  connect();
})();
</script>
</body>
</html>
`
