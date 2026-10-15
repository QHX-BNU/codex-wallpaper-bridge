using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Threading;
using System.Drawing;
using System.Drawing.Imaging;

namespace CwbMedia {
  // Only the current render endpoint is captured. PCM remains in this process.
  public sealed class Host : IDisposable {
    public volatile bool Stopped;
    public volatile string AudioState = "off";
    public readonly ConcurrentQueue<string> Commands = new ConcurrentQueue<string>();
    readonly object gate = new object();
    readonly object outputGate = new object(); long sequence;
    double[] spectrum = new double[128];
    Thread inputThread, audioThread;
    public Host(bool audio) {
      inputThread = new Thread(ReadCommands); inputThread.IsBackground = true; inputThread.Start();
      if (audio) { audioThread = new Thread(Capture); audioThread.IsBackground = true; audioThread.SetApartmentState(ApartmentState.MTA); audioThread.Start(); }
    }
    void ReadCommands() {
      try {
        while (!Stopped) {
          var text = new System.Text.StringBuilder(); int c;
          while ((c = Console.In.Read()) >= 0 && c != '\n') {
            if (text.Length >= 4096) { Stopped = true; return; }
            text.Append((char)c);
          }
          if (c < 0) { Stopped = true; return; }
          if (Commands.Count < 8) Commands.Enqueue(text.ToString());
        }
      } catch { Stopped = true; }
    }
    public string NextCommand() { string value; return Commands.TryDequeue(out value) ? value : null; }
    public static bool SameSession(object first, object second) {
      if (first == null || second == null) return false;
      IntPtr a = IntPtr.Zero, b = IntPtr.Zero;
      try { a = Marshal.GetIUnknownForObject(first); b = Marshal.GetIUnknownForObject(second); return a == b; }
      catch { return false; }
      finally { if (a != IntPtr.Zero) Marshal.Release(a); if (b != IntPtr.Zero) Marshal.Release(b); }
    }
    public void EmitJson(string json) {
      if (json == null || json.Length > 65536 || !json.StartsWith("{")) return;
      lock (outputGate) { Console.Out.WriteLine("{\"seq\":" + (++sequence) + "," + json.Substring(1)); Console.Out.Flush(); }
    }
    void EmitAudio(double[] values) {
      var parts = new string[128];
      for (int i = 0; i < 128; i++) parts[i] = values[i].ToString("F5", System.Globalization.CultureInfo.InvariantCulture);
      EmitJson("{\"type\":\"input\",\"input\":{\"op\":\"audio\",\"values\":[" + String.Join(",", parts) + "]}}");
    }
    public double[] Spectrum() { lock (gate) { return (double[])spectrum.Clone(); } }
    [DllImport("kernel32.dll")] static extern bool GetSystemPowerStatus(out PowerStatus status);
    [StructLayout(LayoutKind.Sequential)] struct PowerStatus { public byte AC, Flag, Life, Saver; public uint Seconds, Full; }
    public static int Battery() { PowerStatus value; return GetSystemPowerStatus(out value) && value.AC <= 1 ? (value.AC == 0 ? 1 : 0) : -1; }
    [DllImport("shcore.dll", ExactSpelling = true)]
    static extern int CreateStreamOverRandomAccessStream(IntPtr randomAccessStream, ref Guid iid, out IntPtr stream);
    // Windows PowerShell 5.1 returns this WinRT value as System.__ComObject and
    // cannot dynamically call GetInputStreamAt. Convert it to a classic COM
    // IStream without exposing a path or copying more than the fixed limit.
    public static byte[] ReadRandomAccessStream(object value, int limit) {
      if (value == null || limit < 1 || limit > 2097152) return new byte[0];
      IntPtr unknown = IntPtr.Zero, pointer = IntPtr.Zero; object wrapper = null;
      try {
        unknown = Marshal.GetIUnknownForObject(value);
        Guid iid = typeof(IStream).GUID;
        int result = CreateStreamOverRandomAccessStream(unknown, ref iid, out pointer);
        if (result < 0 || pointer == IntPtr.Zero) return new byte[0];
        wrapper = Marshal.GetObjectForIUnknown(pointer);
        Marshal.Release(pointer); pointer = IntPtr.Zero;
        var input = (IStream)wrapper;
        using (var output = new MemoryStream()) {
          var buffer = new byte[81920]; IntPtr read = Marshal.AllocHGlobal(sizeof(int));
          try {
            while (output.Length <= limit) {
              Marshal.WriteInt32(read, 0); input.Read(buffer, Math.Min(buffer.Length, limit + 1 - (int)output.Length), read);
              int count = Marshal.ReadInt32(read); if (count <= 0) break;
              output.Write(buffer, 0, count);
            }
          } finally { Marshal.FreeHGlobal(read); }
          return output.Length <= limit ? output.ToArray() : new byte[0];
        }
      } catch { return new byte[0]; }
      finally {
        if (wrapper != null && Marshal.IsComObject(wrapper)) try { Marshal.FinalReleaseComObject(wrapper); } catch {}
        if (pointer != IntPtr.Zero) Marshal.Release(pointer);
        if (unknown != IntPtr.Zero) Marshal.Release(unknown);
      }
    }
    public static string Thumbnail(byte[] bytes) {
      if (bytes == null || bytes.Length == 0 || bytes.Length > 2097152) return "";
      try {
        using (var input = new MemoryStream(bytes)) using (var image = Image.FromStream(input)) {
          if (image.Width > 8192 || image.Height > 8192) return "";
          double scale = Math.Min(1, 128.0 / Math.Max(image.Width, image.Height));
          using (var bitmap = new Bitmap(Math.Max(1, (int)(image.Width * scale)), Math.Max(1, (int)(image.Height * scale)))) {
            using (var graphics = Graphics.FromImage(bitmap)) graphics.DrawImage(image, 0, 0, bitmap.Width, bitmap.Height);
            using (var output = new MemoryStream()) { bitmap.Save(output, ImageFormat.Jpeg); return output.Length <= 32768 ? "data:image/jpeg;base64," + Convert.ToBase64String(output.ToArray()) : ""; }
          }
        }
      } catch { return ""; }
    }
    public static double[] Transform(double[] samples) {
      const int n = 1024; var re = new double[n]; var im = new double[n];
      for (int i = 0; i < n; i++) re[i] = samples[i] * (0.5 - 0.5 * Math.Cos(2 * Math.PI * i / (n - 1)));
      for (int i = 1, j = 0; i < n; i++) {
        int bit = n >> 1; for (; (j & bit) != 0; bit >>= 1) j ^= bit; j ^= bit;
        if (i < j) { double temp = re[i]; re[i] = re[j]; re[j] = temp; }
      }
      for (int len = 2; len <= n; len <<= 1) {
        double angle = -2 * Math.PI / len;
        for (int i = 0; i < n; i += len) for (int j = 0; j < len / 2; j++) {
          double wr = Math.Cos(angle * j), wi = Math.Sin(angle * j);
          int a = i + j, b = a + len / 2;
          double r = re[b] * wr - im[b] * wi, m = re[b] * wi + im[b] * wr;
          re[b] = re[a] - r; im[b] = im[a] - m; re[a] += r; im[a] += m;
        }
      }
      var output = new double[64];
      for (int band = 0; band < 64; band++) {
        int lo = Math.Max(1, (int)Math.Pow(512, band / 64.0)), hi = Math.Min(512, Math.Max(lo + 1, (int)Math.Pow(512, (band + 1) / 64.0)));
        double max = 0; for (int k = lo; k < hi; k++) max = Math.Max(max, Math.Sqrt(re[k] * re[k] + im[k] * im[k]) / 256);
        output[band] = Math.Max(0, Math.Min(1, (20 * Math.Log10(Math.Max(0.00001, max)) + 60) / 60));
      }
      return output;
    }
    void Capture() {
      while (!Stopped) {
        try { CaptureDevice(); } catch {}
        AudioState = "unavailable"; lock (gate) spectrum = new double[128];
        if (!Stopped) EmitJson("{\"type\":\"status\",\"source\":\"audio\",\"state\":\"unavailable\"}");
        for (int i = 0; i < 20 && !Stopped; i++) Thread.Sleep(100); // bounded device recovery, no task queue
      }
    }
    static void Check(int hr) { if (hr < 0) Marshal.ThrowExceptionForHR(hr); }
    static void Release(object value) { if (value != null && Marshal.IsComObject(value)) Marshal.FinalReleaseComObject(value); }
    void CaptureDevice() {
      IMMDeviceEnumerator devices = null; IMMDevice device = null; IAudioClient client = null; IAudioCaptureClient capture = null; IntPtr format = IntPtr.Zero;
      try {
        devices = (IMMDeviceEnumerator)new MMDeviceEnumerator(); Check(devices.GetDefaultAudioEndpoint(0, 1, out device));
        string deviceId; Check(device.GetId(out deviceId));
        var iid = typeof(IAudioClient).GUID; object obj; Check(device.Activate(ref iid, 23, IntPtr.Zero, out obj)); client = (IAudioClient)obj;
        Check(client.GetMixFormat(out format)); var wave = (WaveFormat)Marshal.PtrToStructure(format, typeof(WaveFormat));
        ushort tag = wave.Tag;
        if (tag == 0xfffe && wave.Extra >= 22) {
          var sub = (Guid)Marshal.PtrToStructure(IntPtr.Add(format, 24), typeof(Guid));
          if (sub == new Guid("00000003-0000-0010-8000-00aa00389b71")) tag = 3;
          else if (sub == new Guid("00000001-0000-0010-8000-00aa00389b71")) tag = 1;
        }
        if (wave.Channels < 1 || wave.Channels > 32 || wave.Rate < 8000 || wave.Rate > 384000 || wave.Block != wave.Channels * (wave.Bits / 8)
          || !(tag == 3 && wave.Bits == 32 || tag == 1 && (wave.Bits == 16 || wave.Bits == 24 || wave.Bits == 32))) throw new Exception("audio_format");
        Check(client.Initialize(0, 0x20000, 1000000, 0, format, IntPtr.Zero));
        iid = typeof(IAudioCaptureClient).GUID; Check(client.GetService(ref iid, out obj)); capture = (IAudioCaptureClient)obj;
        Check(client.Start()); AudioState = "ready";
        EmitJson("{\"type\":\"status\",\"source\":\"audio\",\"state\":\"ready\"}");
        var left = new double[1024]; var right = new double[1024]; int cursor = 0; long last = 0, deviceCheck = 0, lastPacket = 0;
        var clock = System.Diagnostics.Stopwatch.StartNew();
        while (!Stopped) {
          uint packet; Check(capture.GetNextPacketSize(out packet));
          while (packet > 0 && !Stopped) {
            IntPtr data; uint frames, flags; ulong position, stamp;
            Check(capture.GetBuffer(out data, out frames, out flags, out position, out stamp));
            try {
              if (frames > 65536) throw new Exception("audio_packet");
              byte[] bytes = new byte[checked((int)frames * wave.Block)];
              if ((flags & 2) == 0) Marshal.Copy(data, bytes, 0, bytes.Length);
              for (int f = 0; f < frames; f++) {
                int offset = f * wave.Block;
                left[cursor] = Sample(bytes, offset, tag, wave.Bits);
                right[cursor] = wave.Channels > 1 ? Sample(bytes, offset + wave.Bits / 8, tag, wave.Bits) : left[cursor]; cursor = (cursor + 1) % 1024;
              }
              lastPacket = clock.ElapsedMilliseconds;
            } finally { Check(capture.ReleaseBuffer(frames)); }
            Check(capture.GetNextPacketSize(out packet));
          }
          long now = clock.ElapsedMilliseconds;
          if (now - lastPacket > 200) { Array.Clear(left, 0, left.Length); Array.Clear(right, 0, right.Length); }
          if (now - last >= 66) {
            var l = new double[1024]; var r = new double[1024];
            for (int i = 0; i < 1024; i++) { l[i] = left[(cursor + i) % 1024]; r[i] = right[(cursor + i) % 1024]; }
            var ls = Transform(l); var rs = Transform(r); var result = new double[128]; Array.Copy(ls, 0, result, 0, 64); Array.Copy(rs, 0, result, 64, 64);
            lock (gate) spectrum = result; EmitAudio(result); last = now;
          }
          if (now - deviceCheck > 2000) {
            IMMDevice current; Check(devices.GetDefaultAudioEndpoint(0, 1, out current));
            try { string id; Check(current.GetId(out id)); if (id != deviceId) return; } finally { Release(current); }
            deviceCheck = now;
          }
          Thread.Sleep(10);
        }
      } finally {
        if (client != null) try { client.Stop(); } catch {}
        if (format != IntPtr.Zero) Marshal.FreeCoTaskMem(format);
        Release(capture); Release(client); Release(device); Release(devices);
      }
    }
    static double Sample(byte[] data, int offset, int tag, int bits) {
      double value;
      if (tag == 3) value = BitConverter.ToSingle(data, offset);
      else if (bits == 16) value = BitConverter.ToInt16(data, offset) / 32768.0;
      else if (bits == 32) value = BitConverter.ToInt32(data, offset) / 2147483648.0;
      else { int n = data[offset] | data[offset + 1] << 8 | data[offset + 2] << 16; if ((n & 0x800000) != 0) n |= unchecked((int)0xff000000); value = n / 8388608.0; }
      return Double.IsNaN(value) || Double.IsInfinity(value) ? 0 : Math.Max(-1, Math.Min(1, value));
    }
    public void Dispose() { Stopped = true; if (audioThread != null && !audioThread.Join(2500)) throw new Exception("audio_stop_timeout"); }
  }
  [StructLayout(LayoutKind.Sequential, Pack = 2)] struct WaveFormat { public ushort Tag, Channels; public uint Rate, Average; public ushort Block, Bits, Extra; }
  [ComImport, Guid("bcde0395-e52f-467c-8e3d-c4579291692e")] class MMDeviceEnumerator {}
  [ComImport, Guid("a95664d2-9614-4f35-a746-de8db63617e6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IMMDeviceEnumerator {
    [PreserveSig] int EnumAudioEndpoints(int flow, uint mask, out IntPtr devices);
    [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice device);
  }
  [ComImport, Guid("d666063f-1587-4e43-81f1-b948e807363f"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, uint context, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object obj);
    [PreserveSig] int OpenPropertyStore(uint mode, out IntPtr store);
    [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetState(out uint state);
  }
  [ComImport, Guid("1cb9ad4c-dbfa-4c32-b178-c2f568a703b2"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IAudioClient {
    [PreserveSig] int Initialize(int mode, uint flags, long duration, long periodicity, IntPtr format, IntPtr session);
    [PreserveSig] int GetBufferSize(out uint frames);
    [PreserveSig] int GetStreamLatency(out long latency);
    [PreserveSig] int GetCurrentPadding(out uint frames);
    [PreserveSig] int IsFormatSupported(int mode, IntPtr format, out IntPtr closest);
    [PreserveSig] int GetMixFormat(out IntPtr format);
    [PreserveSig] int GetDevicePeriod(out long normal, out long minimum);
    [PreserveSig] int Start(); [PreserveSig] int Stop(); [PreserveSig] int Reset();
    [PreserveSig] int SetEventHandle(IntPtr handle);
    [PreserveSig] int GetService(ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object obj);
  }
  [ComImport, Guid("c8adbd64-e71e-48a0-a4de-185c395cd317"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface IAudioCaptureClient {
    [PreserveSig] int GetBuffer(out IntPtr data, out uint frames, out uint flags, out ulong position, out ulong stamp);
    [PreserveSig] int ReleaseBuffer(uint frames); [PreserveSig] int GetNextPacketSize(out uint frames);
  }
}
