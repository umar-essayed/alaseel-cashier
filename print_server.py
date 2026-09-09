import sys
import os
import json
import base64
import ctypes
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer

# Windows Spooler functions using ctypes to avoid requiring pywin32 module
try:
    OpenPrinter = ctypes.windll.winspool.OpenPrinterW
    ClosePrinter = ctypes.windll.winspool.ClosePrinter
    StartDocPrinter = ctypes.windll.winspool.StartDocPrinterW
    EndDocPrinter = ctypes.windll.winspool.EndDocPrinter
    StartPagePrinter = ctypes.windll.winspool.StartPagePrinter
    EndPagePrinter = ctypes.windll.winspool.EndPagePrinter
    WritePrinter = ctypes.windll.winspool.WritePrinter
    
    class DOC_INFO_1(ctypes.Structure):
        _fields_ = [
            ("pDocName", ctypes.c_wchar_p),
            ("pOutputFile", ctypes.c_wchar_p),
            ("pDatatype", ctypes.c_wchar_p)
        ]

    # Explicit type definitions to prevent 64-bit pointer truncation in ctypes
    OpenPrinter.argtypes = [ctypes.c_wchar_p, ctypes.POINTER(ctypes.c_void_p), ctypes.c_void_p]
    OpenPrinter.restype = ctypes.c_long

    ClosePrinter.argtypes = [ctypes.c_void_p]
    ClosePrinter.restype = ctypes.c_long

    StartDocPrinter.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(DOC_INFO_1)]
    StartDocPrinter.restype = ctypes.c_ulong

    EndDocPrinter.argtypes = [ctypes.c_void_p]
    EndDocPrinter.restype = ctypes.c_long

    StartPagePrinter.argtypes = [ctypes.c_void_p]
    StartPagePrinter.restype = ctypes.c_long

    EndPagePrinter.argtypes = [ctypes.c_void_p]
    EndPagePrinter.restype = ctypes.c_long

    WritePrinter.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong)]
    WritePrinter.restype = ctypes.c_long
except Exception as e:
    OpenPrinter = None

def print_raw_windows(printer_name, data_bytes):
    if not OpenPrinter:
        raise Exception("winspool.drv is not available on this operating system")
    hPrinter = ctypes.c_void_p()
    if not OpenPrinter(printer_name, ctypes.byref(hPrinter), None):
        raise Exception(f"Failed to open printer: {printer_name}")
    try:
        di = DOC_INFO_1("RAW Print Job", None, "RAW")
        jobId = StartDocPrinter(hPrinter, 1, ctypes.byref(di))
        if jobId == 0:
            raise Exception("Failed to start print job spooler")
        try:
            StartPagePrinter(hPrinter)
            written = ctypes.c_ulong()
            if not WritePrinter(hPrinter, data_bytes, len(data_bytes), ctypes.byref(written)):
                raise Exception("Failed to write printer command bytes")
            EndPagePrinter(hPrinter)
        finally:
            EndDocPrinter(hPrinter)
    finally:
        ClosePrinter(hPrinter)

def print_raw_linux(printer_name, data_bytes):
    with tempfile.NamedTemporaryFile(delete=False) as f:
        f.write(data_bytes)
        temp_name = f.name
    try:
        subprocess.run(["lp", "-d", printer_name, "-o", "raw", temp_name], check=True)
    except Exception as e:
        # Fallback to direct device printing if lp is not configured
        raise e
    finally:
        try:
            os.unlink(temp_name)
        except:
            pass

def print_raw(printer_name, data_bytes):
    if sys.platform == 'win32':
        print_raw_windows(printer_name, data_bytes)
    else:
        print_raw_linux(printer_name, data_bytes)

class PrintServerHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Suppress logging to prevent polluting stderr/stdout logs
        pass

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_POST(self):
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length)
        
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        
        try:
            req = json.loads(post_data.decode('utf-8'))
            printer_name = req.get('printer_name', '')
            print_type = req.get('type', 'escpos') # 'escpos' or 'tspl'
            width_bytes = req.get('width_bytes', 0)
            height_pixels = req.get('height_pixels', 0)
            data_base64 = req.get('data_base64', '')
            
            raw_pixels = base64.b64decode(data_base64)
            
            if print_type == 'escpos':
                # Build ESC/POS raster command: GS v 0 m xL xH yL yH d1...dk
                xL = width_bytes % 256
                xH = width_bytes // 256
                yL = height_pixels % 256
                yH = height_pixels // 256
                
                # ESC/POS Header
                init_cmd = b'\x1b@' # Initialize printer
                align_cmd = b'\x1ba\x01' # Align center
                raster_cmd = b'\x1d\x76\x30\x00' + bytes([xL, xH, yL, yH])
                feed_cmd = b'\n\n\n\n\x1dVA\x00' # Feed and cut
                
                payload = init_cmd + align_cmd + raster_cmd + raw_pixels + feed_cmd
                
            elif print_type == 'tspl':
                # Build TSPL BITMAP command
                width_mm = req.get('width_mm', 58)
                height_mm = req.get('height_mm', 30)
                
                # Header
                header = f"SIZE {width_mm} mm, {height_mm} mm\n"
                header += "GAP 2 mm, 0 mm\n"
                header += "DIRECTION 1\n"
                header += "CLS\n"
                header += f"BITMAP 0,0,{width_bytes},{height_pixels},0,"
                
                payload = header.encode('latin1') + raw_pixels + b"\nPRINT 1,1\n"
            else:
                payload = raw_pixels
                
            print_raw(printer_name, payload)
            
            response = {'success': True, 'message': 'Print job sent successfully'}
            self.wfile.write(json.dumps(response).encode('utf-8'))
            
        except Exception as e:
            response = {'success': False, 'error': str(e)}
            self.wfile.write(json.dumps(response).encode('utf-8'))

    def do_GET(self):
        # Health check or printer list
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        
        printers = []
        try:
            if sys.platform == 'win32':
                import win32print
                list_printers = win32print.EnumPrinters(win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS)
                for p in list_printers:
                    printers.append(p[2])
            else:
                # Parse lpstat on Linux
                out = subprocess.check_output(['lpstat', '-e']).decode('utf-8')
                printers = [line.strip() for line in out.split('\n') if line.strip()]
        except Exception as e:
            pass
            
        response = {'status': 'ok', 'printers': printers}
        self.wfile.write(json.dumps(response).encode('utf-8'))

def run(port=5001):
    server_address = ('127.0.0.1', port)
    httpd = HTTPServer(server_address, PrintServerHandler)
    print(f"Starting print server on port {port}...")
    httpd.serve_forever()

if __name__ == '__main__':
    port = 5001
    if len(sys.argv) > 1:
        try:
            port = int(sys.argv[1])
        except:
            pass
    run(port)
