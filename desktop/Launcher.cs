using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;
class HarpLauncher {
 [STAThread] static void Main() {
  var root=AppDomain.CurrentDomain.BaseDirectory;
  var exe=Path.Combine(root,@"desktop\node_modules\electron\dist\electron.exe");
  try {
   var start=new ProcessStartInfo(exe, "\"" + Path.Combine(root,"desktop") + "\""){WorkingDirectory=root,UseShellExecute=false};
   start.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
   Process.Start(start);
  } catch(Exception e) {MessageBox.Show(e.Message,"Harp Orchestrator");}
 }
}
