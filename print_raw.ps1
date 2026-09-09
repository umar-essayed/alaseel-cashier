param(
    [Parameter(Mandatory=$true)]
    [string]$PrinterName,
    
    [Parameter(Mandatory=$true)]
    [string]$FilePath
)

$Signature = @"
using System;
using System.Runtime.InteropServices;

namespace WinSpool {
    public class RawPrinterHelper {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public class DOCINFOA
        {
            [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
            [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
            [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
        }

        [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool OpenPrinter(string src, ref IntPtr hPrinter, IntPtr pd);

        [DllImport("winspool.drv", EntryPoint = "ClosePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool ClosePrinter(IntPtr hPrinter);

        [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool StartDocPrinter(IntPtr hPrinter, Int32 level, [In, MarshalAs(UnmanagedType.LPStruct)] DOCINFOA di);

        [DllImport("winspool.drv", EntryPoint = "EndDocPrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool EndDocPrinter(IntPtr hPrinter);

        [DllImport("winspool.drv", EntryPoint = "StartPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool StartPagePrinter(IntPtr hPrinter);

        [DllImport("winspool.drv", EntryPoint = "EndPagePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool EndPagePrinter(IntPtr hPrinter);

        [DllImport("winspool.drv", EntryPoint = "WritePrinter", SetLastError = true, ExactSpelling = true, CallingConvention = CallingConvention.StdCall)]
        public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, Int32 dwCount, out Int32 dwWritten);
    }
}
"@

# Suppress errors if type already loaded in this session
try {
    Add-Type -TypeDefinition $Signature -ErrorAction SilentlyContinue | Out-Null
} catch {}

if (-not (Test-Path $FilePath)) {
    Write-Error "File not found: $FilePath"
    exit 1
}

$Bytes = [System.IO.File]::ReadAllBytes($FilePath)
$hPrinter = [IntPtr]::Zero

if (-not [WinSpool.RawPrinterHelper]::OpenPrinter($PrinterName, [ref]$hPrinter, [IntPtr]::Zero)) {
    Write-Error "Failed to open printer: $PrinterName"
    exit 1
}

try {
    $di = New-Object WinSpool.RawPrinterHelper+DOCINFOA
    $di.pDocName = "RAW TSPL Print Job"
    $di.pDataType = "RAW"

    if (-not [WinSpool.RawPrinterHelper]::StartDocPrinter($hPrinter, 1, $di)) {
        Write-Error "Failed to start doc printer."
        exit 1
    }

    try {
        if (-not [WinSpool.RawPrinterHelper]::StartPagePrinter($hPrinter)) {
            Write-Error "Failed to start page printer."
            exit 1
        }

        $size = $Bytes.Length
        $pBytes = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($size)
        try {
            [System.Runtime.InteropServices.Marshal]::Copy($Bytes, 0, $pBytes, $size)
            $written = 0
            if (-not [WinSpool.RawPrinterHelper]::WritePrinter($hPrinter, $pBytes, $size, [ref]$written)) {
                Write-Error "Failed to write printer bytes."
                exit 1
            }
            [WinSpool.RawPrinterHelper]::EndPagePrinter($hPrinter) | Out-Null
        } finally {
            [System.Runtime.InteropServices.Marshal]::FreeHGlobal($pBytes)
        }
    } finally {
        [WinSpool.RawPrinterHelper]::EndDocPrinter($hPrinter) | Out-Null
    }
} finally {
    [WinSpool.RawPrinterHelper]::ClosePrinter($hPrinter) | Out-Null
    # Try deleting the temporary file
    try { Remove-Item -Path $FilePath -Force -ErrorAction SilentlyContinue } catch {}
}

Write-Output "Success"
