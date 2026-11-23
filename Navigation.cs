using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Linq;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

internal sealed partial class OrchestratorWindow
{
    private const string PreferenceKey = @"HKEY_CURRENT_USER\Software\Harp Orchestrator";
    private readonly Panel[] pages = { new Panel(), new Panel(), new Panel() };
    private readonly ActionButton[] tabs = { new ActionButton(), new ActionButton(), new ActionButton() };
    private readonly Panel indicatorTrack = new Panel();
    private readonly Panel indicator = new Panel();
    private readonly Timer animation = new Timer { Interval = 16 };
    private readonly Label projectCount = Caption("—", 26, Ink, true);
    private readonly Label allCount = Caption("—", 26, Ink, true);

    private readonly Label usageNote = Caption("", 10, Muted);
    private int currentPage, savedMode, statsRequest;
    private bool motion;
    private int phase;
    private static string Preference(string key, string fallback)
    {
        return Convert.ToString(Registry.GetValue(PreferenceKey, key, fallback) ?? fallback);
    }
    private static void SavePreference(string key, string value)
    {
        Registry.SetValue(PreferenceKey, key, value, RegistryValueKind.String);
    }

    private readonly TextBox search = new TextBox();
    private readonly ListBox history = new ListBox();
    private readonly ToolTip historyTip = new ToolTip { AutoPopDelay = 15000, InitialDelay = 450, ReshowDelay = 100 };
    private int hoveredRun = -1;
    private readonly List<RunEntry> runs = new List<RunEntry>();
    private readonly Label fileTypes = Caption("", 11, Ink);
    private readonly Label runCount = Caption("—", 22, Ink, true);
    private readonly Label[] modelValues = new Label[3];
    private readonly Panel[] meters = new Panel[3];
    private readonly double[] fractions = new double[3];
    private sealed class RunEntry
    {
        internal string Folder, Goal;
        internal DateTime Date;
        public override string ToString() { return Goal; }
    }

    private void CreateNavigation()
    {
        int.TryParse(Preference("mode", "0"), out savedMode);
        if (savedMode < 0 || savedMode > 2) savedMode = 0;
        motion = Preference("motion", "on") == "on";
        var shell = Grid(2, 1);
        shell.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 304));
        shell.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        Controls.Add(shell);
        var rail = Grid(1, 8);
        rail.BackColor = Graphite;
        rail.Padding = new Padding(14, 16, 14, 14);
        Rows(rail, 60, 43, 43,  40, 32, -1, 14, 44);
        rail.Controls.Add(Caption("Harp Orchestrator", 15, Ink, true), 0, 0);
        var names = new[] { "Рабочая сессия", "Дашборд", "Настройки" };
        var slots = new[] { 2, 1, 7 };
        for (int i = 0; i < tabs.Length; i++)
        {
            int index = i;
            SetupButton(tabs[i], names[i], () => SelectPage(index), true);
            tabs[i].Navigation = true;
            rail.Controls.Add(tabs[i], 0, slots[i]);
        }
        rail.Controls.Add(Caption("История запусков", 10, Muted), 0, 3);
        search.BackColor = Paper; search.ForeColor = Ink;
        search.AccessibleName = "Поиск запусков";
        search.BorderStyle = BorderStyle.FixedSingle;
        search.Dock = DockStyle.Fill;
        rail.Controls.Add(search, 0, 4);
        history.Dock = DockStyle.Fill; history.BorderStyle = BorderStyle.None;
        history.BackColor = Graphite; history.ForeColor = Ink;
        history.DrawMode = DrawMode.OwnerDrawFixed;
        history.Font = new Font("Segoe UI", 10.5f);
        history.ItemHeight = 48;
        history.IntegralHeight = false;
        history.DrawItem += DrawHistoryItem;
        history.MouseMove += (s,e) =>
        {
            int index = history.IndexFromPoint(e.Location);
            if (index == hoveredRun) return;
            hoveredRun = index;
            historyTip.SetToolTip(history, index >= 0 ? ((RunEntry)history.Items[index]).Goal : "");
        };
        history.MouseLeave += (s,e) => { hoveredRun = -1; historyTip.SetToolTip(history, ""); };
        history.HorizontalScrollbar = false;
        history.AccessibleName = "История запусков";
        history.Click += (s,e) => OpenHistory();
        history.KeyDown += (s,e) => { if (e.KeyCode == Keys.Enter) OpenHistory(); };
        search.TextChanged += (s,e) => FilterHistory();
        rail.Controls.Add(history, 0, 5);
        shell.Controls.Add(rail, 0, 0);
        indicatorTrack.Dock = DockStyle.Left;
        indicatorTrack.Width = 3; indicatorTrack.BackColor = Graphite;
        indicator.Width = 3; indicator.Height = 26;
        indicatorTrack.Controls.Add(indicator);
        var container = new Panel { Dock = DockStyle.Fill, Margin = Padding.Empty };
        foreach (Panel p in pages) { p.Dock = DockStyle.Fill; container.Controls.Add(p); }
        shell.Controls.Add(container, 1, 0);
        container.Controls.Add(indicatorTrack); indicatorTrack.BringToFront();
        animation.Tick += (s,e) => TickMotion();
        Shown += (s,e) => { ReloadHistory(); SelectPage(1); };
        rail.SizeChanged += (s,e) => UpdateMotion();
        FormClosed += (s,e) => { animation.Dispose(); historyTip.Dispose(); };
    }

    private void DrawHistoryItem(object sender, DrawItemEventArgs e)
    {
        if (e.Index < 0 || e.Index >= history.Items.Count) return;
        var item = (RunEntry)history.Items[e.Index];
        bool selected = (e.State & DrawItemState.Selected) != 0;
        using (var background = new SolidBrush(Graphite)) e.Graphics.FillRectangle(background, e.Bounds);
        var bounds = new Rectangle(e.Bounds.X + 2, e.Bounds.Y + 2, e.Bounds.Width - 4, e.Bounds.Height - 4);
        if (selected)
        {
            using (var shape = Rounded(bounds, 7))
            using (var brush = new SolidBrush(Color.FromArgb(49, 51, 52)))
                e.Graphics.FillPath(brush, shape);
        }
        var title = new Rectangle(bounds.X + 10, bounds.Y + 4, bounds.Width - 20, 22);
        TextRenderer.DrawText(e.Graphics, item.Goal.Replace("\r", " ").Replace("\n", " "), history.Font, title, Ink,
            TextFormatFlags.Left | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis | TextFormatFlags.NoPrefix);
        using (var font = new Font("Segoe UI", 8.5f))
            TextRenderer.DrawText(e.Graphics, item.Date.ToString("dd MMM · HH:mm"), font,
                new Rectangle(bounds.X + 10, bounds.Y + 26, bounds.Width - 20, 16), Muted,
                TextFormatFlags.Left | TextFormatFlags.SingleLine);
        if ((e.State & DrawItemState.Focus) != 0) e.DrawFocusRectangle();
    }

    private void ReloadHistory()
    {
        runs.Clear();
        string dir = System.IO.Path.Combine(root, ".runs");
        if (System.IO.Directory.Exists(dir))
        {
            foreach (string folder in System.IO.Directory.EnumerateDirectories(dir))
            {
                string file = System.IO.Path.Combine(folder, "plan.json");
                if (!System.IO.File.Exists(file)) continue;
                try
                {
                    var data = new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(System.IO.File.ReadAllText(file));
                    runs.Add(new RunEntry { Folder = folder, Goal = Convert.ToString(data["goal"]), Date = System.IO.File.GetLastWriteTime(file) });
                }
                catch (System.IO.IOException) { }
                catch (ArgumentException) { }
                catch (InvalidOperationException) { }
                catch (KeyNotFoundException) { }
            }
        }
        runs.Sort((a,b) => b.Date.CompareTo(a.Date));
        runCount.Text = runs.Count.ToString();
        FilterHistory();
    }
    private void FilterHistory()
    {
        history.BeginUpdate();
        history.Items.Clear(); hoveredRun = -1; historyTip.SetToolTip(history, "");
        foreach (RunEntry item in runs)
            if (item.Goal.IndexOf(search.Text.Trim(), StringComparison.CurrentCultureIgnoreCase) >= 0) history.Items.Add(item);
        history.EndUpdate();
    }
    private void OpenHistory()
    {
        var item = history.SelectedItem as RunEntry;
        if (item == null) return;
        using (var dialog = new Form { Text = item.Goal, StartPosition = FormStartPosition.CenterParent, Size = new Size(730,520), BackColor = Canvas })
        {
            var report = new RichTextBox { Dock = DockStyle.Fill, ReadOnly = true, BackColor = Paper, ForeColor = Ink, BorderStyle = BorderStyle.None, Font = Font, DetectUrls = false };
            var lines = new List<string> { item.Goal, item.Date.ToString("g"), "" };
            foreach (string file in System.IO.Directory.GetFiles(item.Folder,"*.md").OrderBy(f=>f))
            { lines.Add(System.IO.Path.GetFileNameWithoutExtension(file)); lines.Add(System.IO.File.ReadAllText(file)); lines.Add(""); }
            if (lines.Count == 3) lines.Add("Отчёты ещё не записаны.");
            report.Text = string.Join(Environment.NewLine, lines);
            dialog.Padding = new Padding(16);
            var open = new ActionButton();
            SetupButton(open,"Открыть папку запуска",()=>Process.Start("explorer.exe",Quote(item.Folder)));
            open.Dock = DockStyle.Bottom; open.Height = 38;
            dialog.Controls.Add(report); dialog.Controls.Add(open); dialog.ShowDialog(this);
        }
    }

    private void SelectPage(int index)
    {
        currentPage = index;
        for (int i = 0; i < pages.Length; i++)
        {
            pages[i].Visible = i == index;
            tabs[i].Dark = i != index;
            tabs[i].Primary = i == index;
            tabs[i].Invalidate();
        }
        pages[index].BringToFront(); indicatorTrack.BringToFront();
        UpdateMotion();
        if (index == 1) RefreshUsage();
    }
    private int TargetY() { return tabs[currentPage].Top + (tabs[currentPage].Height - indicator.Height) / 2; }
    private void UpdateMotion()
    {
        if (motion) animation.Start();
        else { animation.Stop(); indicator.Top = TargetY(); indicator.BackColor = Clay; }
    }
    private void TickMotion()
    {
        int delta = TargetY() - indicator.Top;
        indicator.Top += Math.Abs(delta) < 4 ? delta : (int)(delta * 0.28);
        phase = (phase + 1) % 100;
        int pulse = busy ? (int)(24 * Math.Sin(phase * Math.PI / 50)) : 0;
        indicator.BackColor = Color.FromArgb(70 + pulse, 197 + pulse, 180);
        if (!busy && indicator.Top == TargetY()) animation.Stop();
    }

    private static TableLayoutPanel Section(Panel page, params int[] heights)
    {
        var grid = Grid(1, heights.Length);
        grid.Padding = new Padding(32, 22, 32, 22);
        Rows(grid, heights);
        page.Controls.Add(grid);
        return grid;
    }
    private static TableLayoutPanel SettingRow(string label, Control control)
    {
        var row = Grid(2, 1);
        row.Padding = new Padding(16, 4, 16, 4);
        row.BackColor = Paper;
        row.Margin = new Padding(0, 1, 0, 1);
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 53));
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 47));
        row.Controls.Add(Caption(label, 11, Ink), 0, 0);
        control.Anchor = AnchorStyles.Left | AnchorStyles.Right;
        row.Controls.Add(control, 1, 0);
        return row;
    }
    private void CreateSecondaryPages()
    {
        var settings = Section(pages[2], 56, 48, 48, 48, 48, 48, 48, 57, -1);
        settings.Controls.Add(Caption("Настройки", 23, Ink, true), 0, 0);
        var profile = new TextBox { Text = Preference("name", Environment.UserName), BackColor = Graphite, ForeColor = Ink, BorderStyle = BorderStyle.FixedSingle, MaxLength = 60 };
        profile.Leave += (s,e) => SavePreference("name", profile.Text.Trim());
        settings.Controls.Add(SettingRow("Имя профиля", profile), 0, 1);
        var toggle = new CheckBox { Text = "Включены", Checked = motion, ForeColor = Ink, AutoSize = true };
        toggle.CheckedChanged += (s,e) => { motion = toggle.Checked; SavePreference("motion", motion ? "on" : "off"); UpdateMotion(); };
        settings.Controls.Add(SettingRow("Анимации интерфейса", toggle), 0, 2);
        settings.Controls.Add(SettingRow("Планировщик", Caption("Inkling 2 Mini  ·  локально", 11, Mint)), 0, 3);
        settings.Controls.Add(SettingRow("Codex", Caption("Вход через ChatGPT", 11, Ink)), 0, 4);
        settings.Controls.Add(SettingRow("Claude Code", Caption("Вход через Claude.ai", 11, Ink)), 0, 5);
        var defaultMode = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, FlatStyle = FlatStyle.Flat, BackColor = Graphite, ForeColor = Ink };
        defaultMode.Items.AddRange(agent.Items.Cast<object>().ToArray());
        defaultMode.SelectedIndex = agent.SelectedIndex;
        defaultMode.SelectedIndexChanged += (s,e) => { agent.SelectedIndex = defaultMode.SelectedIndex; SavePreference("mode", agent.SelectedIndex.ToString()); };
        agent.SelectedIndexChanged += (s,e) => defaultMode.SelectedIndex = agent.SelectedIndex;
        agent.EnabledChanged += (s,e) => defaultMode.Enabled = agent.Enabled;
        settings.Controls.Add(SettingRow("Режим работы", defaultMode), 0, 6);
        var tools = Grid(2, 1);
        tools.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        tools.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
        SetupButton(check, "Проверить подключения", async () => { SelectPage(0); await Execute("Проверяю подключения…", false, "doctor"); }, true);
        SetupButton(inkling, "Запустить Inkling", () => { SelectPage(0); StartInkling(); }, true);
        tools.Controls.Add(check, 0, 0); tools.Controls.Add(inkling, 1, 0);
        settings.Controls.Add(tools, 0, 7);
        var stats = Section(pages[1], 62, 120, 44, 56, 56, 56, 60, -1);
        stats.Controls.Add(Caption("Обзор работы", 23, Ink, true), 0, 0);
        var cards = Grid(3,1);
        Label[] metrics = { projectCount, allCount, runCount };
        string[] captions = { "Токены проекта", "Токены всего", "Запуски" };
        for (int i=0;i<metrics.Length;i++)
        {
            cards.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f/3));
            var tile = Grid(1,2); tile.BackColor = Paper; tile.Padding = new Padding(13);
            tile.Margin = new Padding(0,3,7,3); Rows(tile, 28,-1);
            tile.Controls.Add(Caption(captions[i],10,Muted),0,0); tile.Controls.Add(metrics[i],0,1);
            cards.Controls.Add(tile,i,0);
        }
        stats.Controls.Add(cards,0,1);
        stats.Controls.Add(Caption("Расход по агентам · все проекты", 13, Ink,true),0,2);
        string[] agents = { "Codex", "Claude Code", "Inkling" };
        for (int i=0;i<agents.Length;i++)
        {
            int index=i;
            var row=Grid(3,1); row.BackColor=Paper; row.Padding=new Padding(14,4,14,4); row.Margin=new Padding(0,1,0,1);
            row.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,115));
            row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent,100));
            row.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute,120));
            row.Controls.Add(Caption(agents[i],11,Ink),0,0);
            var track=new Panel { Height=7, Anchor=AnchorStyles.Left|AnchorStyles.Right, BackColor=Line };
            meters[i]=new Panel { Height=7, Width=0, BackColor=new[]{Mint, Color.LightSteelBlue, Color.SandyBrown}[i] };
            track.Controls.Add(meters[i]); row.Controls.Add(track,1,0);
            track.Resize+=(s,e)=>meters[index].Width=(int)(track.Width*fractions[index]);
            modelValues[i]=Caption("—",12,Ink,true); modelValues[i].TextAlign=ContentAlignment.MiddleRight;
            row.Controls.Add(modelValues[i],2,0); stats.Controls.Add(row,0,3+i);
        }
        stats.Controls.Add(usageNote,0,6);
        stats.Controls.Add(fileTypes,0,7); fileTypes.TextAlign = ContentAlignment.TopLeft;
    }
    private async void RefreshUsage()
    {
        int request = ++statsRequest;
        string path = project.Text.Trim();
        try
        {
            string json = await Task.Run(() =>
            {
                var info = new ProcessStartInfo("node.exe", "orchestrator.mjs usage" +
                    (path.Length == 0 ? "" : " --project " + Quote(path)))
                { WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, StandardOutputEncoding = Encoding.UTF8 };
                using (var p = Process.Start(info))
                {
                    string data = p.StandardOutput.ReadToEnd();
                    p.WaitForExit();
                    if (p.ExitCode != 0) throw new InvalidOperationException("Ошибка чтения журналов");
                    return data;
                }
            });
            if (IsDisposed || request != statsRequest) return;
            var dataSet = new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(json);
            var all = (Dictionary<string,object>)dataSet["totals"];
            var selected = (Dictionary<string,object>)dataSet["selected"];
            projectCount.Text = path.Length == 0 ? "—" : selected.Values.Sum(value => Convert.ToInt64(value)).ToString("N0");
            allCount.Text = all.Values.Sum(value => Convert.ToInt64(value)).ToString("N0");
            long total = all.Values.Sum(value => Convert.ToInt64(value));
            int i = 0;
            foreach (string name in new[]{ "codex", "claude", "inkling" })
            {
                long count = Convert.ToInt64(all[name]);
                modelValues[i].Text = count.ToString("N0");
                fractions[i] = total == 0 ? 0 : (double)count / total;
                meters[i].Width = (int)(meters[i].Parent.Width * fractions[i]);
                i++;
            }
            fileTypes.Text = dataSet.ContainsKey("fileTypes") ? "Файлы проекта по типам" + Environment.NewLine + Convert.ToString(dataSet["fileTypes"]) : "Выбери Git-проект для обзора файлов.";
            usageNote.Text = "По сохранённым журналам. Записей без счётчика: " + dataSet["missing"] + ".";
        }
        catch (Exception ex) { if (!IsDisposed && request == statsRequest) usageNote.Text = ex.Message; }
    }
}
