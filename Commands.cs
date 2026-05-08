using System;
using System.Drawing;
using System.IO;
using System.Net.Http;
using System.Threading.Tasks;
using System.Windows.Forms;
using Autodesk.AutoCAD.ApplicationServices;
using Autodesk.AutoCAD.DatabaseServices;
using Autodesk.AutoCAD.EditorInput;
using Autodesk.AutoCAD.Geometry;
using Autodesk.AutoCAD.Runtime;

// AutoCAD plugin: 명령으로 선택된 객체들의 경계(GeometricExtents)를 계산하고
// 중심 좌표를 구한 후 Kakao Static Map API를 호출해 WinForms PictureBox에 이미지를 표시합니다.
public class Commands : IExtensionApplication
{
    public void Initialize() { }
    public void Terminate() { }

    [CommandMethod("ShowMapFromSelection")]
    public void ShowMapFromSelection()
    {
        var doc = Application.DocumentManager.MdiActiveDocument;
        if (doc == null) return;

        var ed = doc.Editor;
        try
        {
            var psr = ed.GetSelection();
            if (psr.Status != PromptStatus.OK)
            {
                ed.WriteMessage("\nSelection canceled or failed.");
                return;
            }

            // 선택된 객체들의 전체 범위를 계산
            Point3d min = new Point3d(double.MaxValue, double.MaxValue, double.MaxValue);
            Point3d max = new Point3d(double.MinValue, double.MinValue, double.MinValue);

            using (var tr = doc.TransactionManager.StartTransaction())
            {
                foreach (ObjectId id in psr.Value.GetObjectIds())
                {
                    var ent = tr.GetObject(id, OpenMode.ForRead) as Entity;
                    if (ent == null) continue;
                    try
                    {
                        var ext = ent.GeometricExtents; // may throw if extents unavailable
                        min = new Point3d(Math.Min(min.X, ext.MinPoint.X), Math.Min(min.Y, ext.MinPoint.Y), Math.Min(min.Z, ext.MinPoint.Z));
                        max = new Point3d(Math.Max(max.X, ext.MaxPoint.X), Math.Max(max.Y, ext.MaxPoint.Y), Math.Max(max.Z, ext.MaxPoint.Z));
                    }
                    catch
                    {
                        // 일부 엔티티에서 GeometricExtents가 제공되지 않을 수 있음 — 무시
                    }
                }
                tr.Commit();
            }

            if (min.X == double.MaxValue || max.X == double.MinValue)
            {
                ed.WriteMessage("\nFailed to compute extents from selection.");
                return;
            }

            // 중심 좌표 계산
            var center = new Point3d((min.X + max.X) / 2.0, (min.Y + max.Y) / 2.0, (min.Z + max.Z) / 2.0);

            // 폼을 모델리스로 띄움
            var form = new MapForm(center);
            // AutoCAD에서 안전하게 모델리스 폼 띄우기
            Application.ShowModelessDialog(form);
        }
        catch (System.Exception ex)
        {
            ed.WriteMessage($"\nError: {ex.Message}");
        }
    }
}

public class MapForm : Form
{
    private PictureBox pictureBox;
    private Label lblStatus;
    private Button btnRefresh;
    private Point3d centerPoint;

    // REST API 키를 아래에 넣어야 합니다.
    // 주의: 실제 배포시에는 키를 하드코딩 하지 말고 안전한 저장소(환경변수 등)를 사용하세요.
    private const string KakaoRestApiKey = "YOUR_REST_API_KEY"; // <- 여기에 REST API 키 입력

    public MapForm(Point3d center)
    {
        centerPoint = center;
        InitializeComponents();
    }

    private void InitializeComponents()
    {
        this.Text = "Kakao Static Map - from AutoCAD selection";
        this.ClientSize = new Size(700, 500);
        this.StartPosition = FormStartPosition.CenterScreen;

        pictureBox = new PictureBox { Dock = DockStyle.Fill, SizeMode = PictureBoxSizeMode.Zoom };
        lblStatus = new Label { Dock = DockStyle.Top, Height = 24, Text = "Initializing..." };
        btnRefresh = new Button { Text = "Refresh", Dock = DockStyle.Top, Height = 28 };
        btnRefresh.Click += async (s, e) => await LoadMapAsync();

        this.Controls.Add(pictureBox);
        this.Controls.Add(btnRefresh);
        this.Controls.Add(lblStatus);

        this.Load += async (s, e) => await LoadMapAsync();
    }

    private async Task LoadMapAsync()
    {
        lblStatus.Text = $"Fetching map for center: {centerPoint.X:0.#####}, {centerPoint.Y:0.#####}";
        try
        {
            var img = await FetchMapImageAsync(centerPoint);
            if (img != null)
            {
                pictureBox.Image?.Dispose();
                pictureBox.Image = img;
                lblStatus.Text = "Map loaded.";
            }
            else
            {
                lblStatus.Text = "Failed to load map image.";
            }
        }
        catch (Exception ex)
        {
            lblStatus.Text = "Error fetching map: " + ex.Message;
            MessageBox.Show(this, "Error fetching map:\n" + ex.Message, "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private async Task<Image> FetchMapImageAsync(Point3d center)
    {
        // Kakao Static Map API 사용 예시
        // center 파라미터는 경도(x),위도(y) 순서로 들어갑니다. AutoCAD 좌표계가 지도 좌표계(WGS84)와 다를 수 있으므로
        // 실제 위/경도로 변환이 필요하면 추가 작업이 필요합니다.

        if (string.IsNullOrWhiteSpace(KakaoRestApiKey) || KakaoRestApiKey == "YOUR_REST_API_KEY")
            throw new InvalidOperationException("Kakao REST API 키를 설정하세요 (KakaoRestApiKey 상수).\n실제 배포 시 환경변수 사용 권장.");

        // 이미지 크기와 줌 레벨은 필요에 따라 조절
        int w = 640, h = 480, level = 5;
        // Kakao expects center as longitude,latitude (x,y)
        string centerStr = string.Format(System.Globalization.CultureInfo.InvariantCulture, "{0},{1}", center.X, center.Y);
        string url = $"https://dapi.kakao.com/v2/maps/sdk/staticmap?center={centerStr}&level={level}&w={w}&h={h}&markers=type:t|size:mid|pos:{centerStr}";

        using (var client = new HttpClient())
        {
            client.DefaultRequestHeaders.Clear();
            client.DefaultRequestHeaders.Add("Authorization", "KakaoAK " + KakaoRestApiKey);
            using (var resp = await client.GetAsync(url))
            {
                if (!resp.IsSuccessStatusCode)
                {
                    var text = await resp.Content.ReadAsStringAsync();
                    throw new HttpRequestException($"API call failed: {(int)resp.StatusCode} {resp.ReasonPhrase}\n{text}");
                }
                var bytes = await resp.Content.ReadAsByteArrayAsync();
                using (var ms = new MemoryStream(bytes))
                {
                    return Image.FromStream(ms);
                }
            }
        }
    }
}
