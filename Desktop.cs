using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;

internal sealed partial class OrchestratorWindow : Form
{
    private readonly string root = AppDomain.CurrentDomain.BaseDirectory;
    private readonly TextBox project = new TextBox();
    private readonly TextBox goal = new TextBox();
    private readonly RichTextBox output = new RichTextBox();
    private readonly ComboBox agent = new ComboBox();
    private readonly Label status = new Label();
    private readonly ActionButton choose = new ActionButton();
    private readonly ActionButton plan = new ActionButton();
    private readonly ActionButton run = new ActionButton();
    private readonly ActionButton check = new ActionButton();
    private readonly ActionButton inkling = new ActionButton();
    private readonly ActionButton results = new ActionButton();
    private string manifest;
    private string resultFolder;
    private bool busy;

    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new OrchestratorWindow());
    }

    private static readonly Color Canvas = ColorTranslator.FromHtml("#191B1C");
    private static readonly Color Paper = ColorTranslator.FromHtml("#242728");
    private static readonly Color Ink = ColorTranslator.FromHtml("#EFF1F6");
    private static readonly Color Muted = ColorTranslator.FromHtml("#AAB3C2");
    private static readonly Color Line = ColorTranslator.FromHtml("#323C3C");
    private static readonly Color Graphite = ColorTranslator.FromHtml("#202223");
    private static readonly Color Clay = ColorTranslator.FromHtml("#20766F");
    private static readonly Color Mint = ColorTranslator.FromHtml("#ABE3CC");
    private readonly Label empty = new Label();

    private OrchestratorWindow()
    {
        Text = "Harp Orchestrator";
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(1040, 640);
        Size = new Size(1180, 760);
        Font = new Font("Segoe UI", 10);
        BackColor = Canvas;
        ForeColor = Ink;
        AutoScaleMode = AutoScaleMode.Dpi;

        CreateNavigation();
        var main = Grid(1, 5);
        main.Padding = new Padding(28, 19, 28, 17);
        Rows(main, 53, 70, -1, 174, 36);
        pages[0].Controls.Add(main);
        var header = Grid(2, 1);
        header.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        header.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 172));
        header.Controls.Add(Caption("Рабочая сессия", 20, Ink, true), 0, 0);
        SetupButton(results, "Открыть результаты", () => Process.Start("explorer.exe", Quote(resultFolder)));
        results.Margin = new Padding(6, 6, 0, 9);
        header.Controls.Add(results, 1, 0);
        main.Controls.Add(header, 0, 0);

        var projectBox = Grid(2, 2);
        projectBox.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        projectBox.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 112));
        Rows(projectBox, 23, 36);
        projectBox.Controls.Add(Caption("Папка Git-репозитория", 10, Muted), 0, 0);
        var pathSurface = new Surface(Paper, Line, 9) { Padding = new Padding(11, 8, 10, 4) };
        project.BorderStyle = BorderStyle.None;
        project.BackColor = Paper;
        project.ForeColor = Ink;
        project.Dock = DockStyle.Top;
        project.AccessibleName = "Папка Git-репозитория";
        pathSurface.Controls.Add(project);
        projectBox.Controls.Add(pathSurface, 0, 1);
        SetupButton(choose, "Выбрать…", () =>
        {
            using (var picker = new FolderBrowserDialog())
            {
                picker.Description = "Выбери папку Git-репозитория";
                if (Directory.Exists(project.Text)) picker.SelectedPath = project.Text;
                if (picker.ShowDialog(this) == DialogResult.OK) project.Text = picker.SelectedPath;
            }
        });
        choose.Margin = new Padding(8, 1, 0, 1);
        projectBox.Controls.Add(choose, 1, 1);
        main.Controls.Add(projectBox, 0, 1);

        var transcript = new Surface(Paper, Line, 14) { Padding = new Padding(17, 13, 17, 13), Margin = new Padding(0, 3, 0, 10) };
        var transcriptLayout = Grid(1, 2); transcriptLayout.BackColor = Paper;
        Rows(transcriptLayout, 32, -1);
        transcriptLayout.Controls.Add(Caption("План и отчёты", 14, Ink, true), 0, 0);
        var logArea = new Panel { Dock = DockStyle.Fill, Margin = Padding.Empty, BackColor = Paper };
        output.ReadOnly = true;
        output.DetectUrls = false;
        output.Dock = DockStyle.Fill;
        output.BorderStyle = BorderStyle.None;
        output.BackColor = Paper;
        output.ForeColor = Ink;
        output.ScrollBars = RichTextBoxScrollBars.Vertical;
        output.AccessibleName = "План и отчёты";
        empty.Dock = DockStyle.Fill;
        empty.BackColor = Paper;
        empty.ForeColor = Muted;
        empty.TextAlign = ContentAlignment.MiddleCenter;
        empty.Text = "План и ответы агентов появятся после запуска.";
        output.TextChanged += (sender, e) => empty.Visible = output.TextLength == 0;
        logArea.Controls.Add(output);
        logArea.Controls.Add(empty);
        empty.BringToFront();
        transcriptLayout.Controls.Add(logArea, 0, 1);
        transcript.Controls.Add(transcriptLayout);
        main.Controls.Add(transcript, 0, 2);

        var composer = new Surface(Paper, Line, 16) { Padding = new Padding(15, 11, 15, 10) };
        var composeLayout = Grid(1, 3); composeLayout.BackColor = Paper;
        Rows(composeLayout, 26, -1, 41);
        composeLayout.Controls.Add(Caption("Что нужно сделать", 11, Ink, true), 0, 0);
        goal.Multiline = true;
        goal.MaxLength = 3000;
        goal.ScrollBars = ScrollBars.Vertical;
        goal.Dock = DockStyle.Fill;
        goal.BorderStyle = BorderStyle.None;
        goal.BackColor = Paper;
        goal.ForeColor = Ink;
        goal.AccessibleName = "Описание задачи";
        composeLayout.Controls.Add(goal, 0, 1);

        var actions = Grid(3, 1);
        actions.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        actions.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 135));
        actions.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 117));
        agent.Dock = DockStyle.Fill;
        agent.Margin = new Padding(0, 9, 15, 0);
        agent.DropDownStyle = ComboBoxStyle.DropDownList;
        agent.FlatStyle = FlatStyle.Flat;
        agent.BackColor = Canvas;
        agent.ForeColor = Ink;
        agent.AccessibleName = "Исполнитель";
        agent.Items.AddRange(new object[] { "Inkling · Codex и Claude", "Только Codex (GPT)", "Только Claude Code" });
        agent.SelectedIndex = savedMode;
        actions.Controls.Add(agent, 0, 0);
        SetupButton(plan, "Составить план", async () => await MakePlan());
        SetupButton(run, "Запустить", async () => await RunPlan(), false, true);
        actions.Controls.Add(plan, 1, 0);
        actions.Controls.Add(run, 2, 0);
        composeLayout.Controls.Add(actions, 0, 2);
        composer.Controls.Add(composeLayout);
        main.Controls.Add(composer, 0, 3);

        status.Dock = DockStyle.Fill;
        status.ForeColor = Muted;
        status.TextAlign = ContentAlignment.MiddleLeft;
        status.AutoEllipsis = true;
        status.Text = "Выбери проект и опиши задачу.";
        main.Controls.Add(status, 0, 4);
        project.TextChanged += (sender, e) => InvalidatePlan();
        goal.TextChanged += (sender, e) => InvalidatePlan();
        agent.SelectedIndexChanged += (sender, e) => InvalidatePlan();
        project.Text = Preference("project", "");
        CreateSecondaryPages();
        FormClosing += (sender, e) =>
        {
            if (!busy) { SavePreference("project", project.Text); SavePreference("mode", agent.SelectedIndex.ToString()); return; }
            e.Cancel = true;
            MessageBox.Show(this, "Дождись завершения текущей операции.", Text);
        };
        RefreshButtons();
    }

    private static TableLayoutPanel Grid(int columns, int rows)
    {
        return new TableLayoutPanel
        {
            Dock = DockStyle.Fill, Margin = Padding.Empty, ColumnCount = columns, RowCount = rows,
            GrowStyle = TableLayoutPanelGrowStyle.FixedSize
        };
    }

    private static void Rows(TableLayoutPanel grid, params int[] heights)
    {
        foreach (int height in heights)
            grid.RowStyles.Add(new RowStyle(height < 0 ? SizeType.Percent : SizeType.Absolute, height < 0 ? 100 : height));
    }

    private static Label Caption(string text, int size, Color color, bool bold = false, string family = "Segoe UI")
    {
        return new Label
        {
            Text = text, ForeColor = color, Font = new Font(family, size, bold ? FontStyle.Bold : FontStyle.Regular),
            Dock = DockStyle.Fill, TextAlign = ContentAlignment.MiddleLeft, Margin = Padding.Empty
        };
    }

    private static System.Drawing.Drawing2D.GraphicsPath Rounded(Rectangle rect, int radius)
    {
        int d = Math.Min(radius * 2, Math.Min(rect.Width, rect.Height));
        var path = new System.Drawing.Drawing2D.GraphicsPath();
        if (d <= 0) return path;
        path.AddArc(rect.Left, rect.Top, d, d, 180, 90);
        path.AddArc(rect.Right - d, rect.Top, d, d, 270, 90);
        path.AddArc(rect.Right - d, rect.Bottom - d, d, d, 0, 90);
        path.AddArc(rect.Left, rect.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    private sealed class Surface : Panel
    {
        private readonly Color fill;
        private readonly Color border;
        private readonly int radius;

        internal Surface(Color fill, Color border, int radius)
        {
            this.fill = fill;
            this.border = border;
            this.radius = radius;
            Dock = DockStyle.Fill;
            Margin = Padding.Empty;
            SetStyle(ControlStyles.ResizeRedraw | ControlStyles.OptimizedDoubleBuffer, true);
        }

        protected override void OnPaintBackground(PaintEventArgs e)
        {
            base.OnPaintBackground(e);
            e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            using (var shape = Rounded(new Rectangle(0, 0, Width - 1, Height - 1), radius))
            using (var brush = new SolidBrush(fill))
            using (var pen = new Pen(border))
            {
                e.Graphics.FillPath(brush, shape);
                e.Graphics.DrawPath(pen, shape);
            }
        }
    }

    private sealed class ActionButton : Button
    {
        internal bool Navigation;
        internal bool Dark;
        internal bool Primary;
        private bool hover;

        protected override void OnMouseEnter(EventArgs e) { base.OnMouseEnter(e); hover = true; Invalidate(); }
        protected override void OnMouseLeave(EventArgs e) { base.OnMouseLeave(e); hover = false; Invalidate(); }

        protected override void OnPaint(PaintEventArgs e)
        {
            e.Graphics.Clear(Dark ? Graphite : Parent.BackColor);
            Color fill = !Enabled ? ColorTranslator.FromHtml("#252C37") : Primary
                ? (hover ? ColorTranslator.FromHtml("#2E8780") : Clay)
                : Dark ? ColorTranslator.FromHtml(hover ? "#323947" : "#212935")
                : (hover ? ColorTranslator.FromHtml("#293342") : Paper);
            if (Navigation)
                fill = Primary ? Color.FromArgb(54, 57, 57) : hover ? Color.FromArgb(44, 47, 48) : Graphite;
            Color stroke = Focused && Enabled ? (Dark ? Mint : Clay) : Dark ? ColorTranslator.FromHtml("#404A59") : Line;
            if (Navigation && !Focused) stroke = fill;
            Color label = !Enabled ? ColorTranslator.FromHtml("#99A2B3") : Dark || Primary ? Color.White : Ink;
            e.Graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            using (var shape = Rounded(new Rectangle(0, 0, Width - 1, Height - 1), 9))
            using (var brush = new SolidBrush(fill))
            using (var pen = new Pen(stroke))
            {
                e.Graphics.FillPath(brush, shape);
                e.Graphics.DrawPath(pen, shape);
            }
            TextRenderer.DrawText(e.Graphics, Text, Font, Navigation ? new Rectangle(14, 0, Width - 28, Height) : ClientRectangle, label,
                (Navigation ? TextFormatFlags.Left : TextFormatFlags.HorizontalCenter) | TextFormatFlags.VerticalCenter | TextFormatFlags.SingleLine | TextFormatFlags.EndEllipsis);
        }
    }

    private static void SetupButton(ActionButton button, string text, Action clicked, bool dark = false, bool primary = false)
    {
        button.Text = text;
        button.Dock = DockStyle.Fill;
        button.Margin = new Padding(3, 3, 3, 3);
        button.FlatStyle = FlatStyle.Flat;
        button.Dark = dark;
        button.Primary = primary;
        button.Cursor = Cursors.Hand;
        button.Click += (sender, e) => clicked();
    }

    private void InvalidatePlan()
    {
        manifest = null;
        status.Text = "Составь план для текущей задачи.";
        RefreshButtons();
    }

    private void RefreshButtons()
    {
        project.Enabled = goal.Enabled = agent.Enabled = choose.Enabled = check.Enabled = inkling.Enabled = !busy;
        plan.Enabled = !busy && !string.IsNullOrWhiteSpace(project.Text) && !string.IsNullOrWhiteSpace(goal.Text);
        run.Enabled = !busy && manifest != null;
        results.Enabled = resultFolder != null && Directory.Exists(resultFolder);
    }

    private async Task MakePlan()
    {
        manifest = null;
        output.Clear();
        RefreshButtons();
        string path = Path.Combine(root, ".runs", "desktop-" + Guid.NewGuid() + ".json");
        string mode = new[] { "auto", "codex", "claude" }[agent.SelectedIndex];
        if (await Execute("Составляю план…", false, "plan", "--project", project.Text.Trim(), "--goal", goal.Text.Trim(), "--agent", mode, "--out", path) && File.Exists(path))
        {
            manifest = path;
            status.Text = "Проверь план и нажми «Запустить».";
            RefreshButtons();
        }
    }

    private async Task RunPlan()
    {
        string path = manifest;
        resultFolder = null;
        output.AppendText(Environment.NewLine);
        bool complete = await Execute("Агенты работают в отдельной Git-ветке…", true, "run", path);
        ReloadHistory(); if (currentPage == 1) RefreshUsage();
        if (complete)
        {
            manifest = null;
            status.Text = "Задача завершена. Результаты доступны в отдельной Git-ветке.";
        }
        RefreshButtons();
    }

    private async Task<bool> Execute(string message, bool trackResults, params string[] args)
    {
        busy = true; UpdateMotion();
        status.Text = message;
        RefreshButtons();
        var start = new ProcessStartInfo
        {
            FileName = "node.exe",
            Arguments = string.Join(" ", new[] { Quote(Path.Combine(root, "orchestrator.mjs")) }.Concat(args.Select(Quote))),
            WorkingDirectory = root,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8
        };
        try
        {
            Directory.CreateDirectory(Path.Combine(root, ".runs"));
            int code = await RunProcess(start, trackResults);
            status.Text = code == 0 ? "Готово." : "Операция остановилась. Подробности в журнале.";
            return code == 0;
        }
        catch (Exception error)
        {
            Append("Ошибка запуска: " + error.Message, false);
            status.Text = "Не удалось запустить операцию.";
            return false;
        }
        finally
        {
            busy = false; UpdateMotion();
            RefreshButtons();
        }
    }

    private Task<int> RunProcess(ProcessStartInfo start, bool trackResults)
    {
        return Task.Run(() =>
        {
            using (var process = new Process { StartInfo = start })
            {
                DataReceivedEventHandler capture = (sender, e) =>
                {
                    if (e.Data != null) BeginInvoke(new Action(() => Append(e.Data, trackResults)));
                };
                process.OutputDataReceived += capture;
                process.ErrorDataReceived += capture;
                process.Start();
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                process.WaitForExit();
                return process.ExitCode;
            }
        });
    }

    private void Append(string line, bool trackResults)
    {
        output.AppendText(line + Environment.NewLine);
        output.ScrollToCaret();
        if (trackResults && line.StartsWith("Каталог ", StringComparison.Ordinal))
        {
            resultFolder = line.Substring("Каталог ".Length);
            RefreshButtons();
        }
    }

    private async void StartInkling()
    {
        try
        {
            if (await Execute("Проверяю Inkling…", false, "inkling-status"))
            {
                status.Text = "Inkling уже запущен.";
                return;
            }
            Process.Start(new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = "-NoProfile -ExecutionPolicy Bypass -NoExit -File " + Quote(Path.Combine(root, "inkling.ps1")) + " -Setup",
                WorkingDirectory = root,
                UseShellExecute = true
            });
            status.Text = "Inkling запускается в отдельном окне. Не закрывай его во время работы.";
        }
        catch (Exception error)
        {
            Append("Не удалось запустить Inkling: " + error.Message, false);
        }
    }

    private static string Quote(string argument)
    {
        // Windows applies special parsing to backslashes next to a quote.
        return "\"" + Regex.Replace(argument, "(\\\\*)\"|(\\\\+)$", match =>
            match.Groups[1].Success
                ? match.Groups[1].Value + match.Groups[1].Value + "\\\""
                : match.Value + match.Value) + "\"";
    }
}

