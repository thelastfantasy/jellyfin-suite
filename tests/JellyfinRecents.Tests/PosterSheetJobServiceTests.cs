using Jellyfin.Plugin.JellyfinRecents.Models;
using Jellyfin.Plugin.JellyfinRecents.Services;
using MediaBrowser.Common.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;
using Xunit;

namespace JellyfinRecents.Tests;

public class PosterSheetJobServiceTests : IDisposable
{
    private readonly string _tempDir;
    private readonly PosterSheetJobService _svc;

    public PosterSheetJobServiceTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), $"jr-test-{Guid.NewGuid():N}");
        Directory.CreateDirectory(_tempDir);

        var appPaths = new Mock<IApplicationPaths>();
        appPaths.Setup(p => p.DataPath).Returns(_tempDir);

        var fontSvc = new FontAcquisitionService(
            appPaths.Object,
            NullLogger<FontAcquisitionService>.Instance);

        _svc = new PosterSheetJobService(
            appPaths.Object,
            NullLogger<PosterSheetJobService>.Instance,
            fontSvc);
    }

    public void Dispose()
    {
        _svc.Dispose();
        try { Directory.Delete(_tempDir, recursive: true); } catch { }
    }

    // ── GetOrCreateJob ────────────────────────────────────────────────────────

    [Fact]
    public void GetOrCreateJob_NewItem_ReturnsJobWithCorrectProperties()
    {
        var req = new PosterSheetRequestDto { Rows = 3, Cols = 4 };
        var job = _svc.GetOrCreateJob("item-1", req, "/nonexistent/video.mkv");

        Assert.Equal("item-1", job.ItemId);
        Assert.Equal(3, job.Rows);
        Assert.Equal(4, job.Cols);
    }

    [Fact]
    public void GetOrCreateJob_SameItemWhileActive_ReturnsSameJob()
    {
        var req = new PosterSheetRequestDto { Rows = 3, Cols = 4 };
        var job1 = _svc.GetOrCreateJob("item-2", req, "/nonexistent/video.mkv");

        // Background task finishes almost instantly when binary is absent.
        // Wait for it to settle, then force status back to Running so the
        // service sees the job as still active on the second call.
        SpinWait.SpinUntil(
            () => job1.Status is not (JobStatus.Queued or JobStatus.Running),
            millisecondsTimeout: 2000);
        job1.Status = JobStatus.Running;

        var job2 = _svc.GetOrCreateJob("item-2", req, "/nonexistent/video.mkv");

        Assert.Equal(job1.Id, job2.Id);
    }

    [Fact]
    public void GetOrCreateJob_DeterministicMode_SeedIsStable()
    {
        var req = new PosterSheetRequestDto { Mode = "deterministic" };
        var job1 = _svc.GetOrCreateJob("item-seed-a", req, "/path");
        _svc.CancelJob(job1.Id);

        var job2 = _svc.GetOrCreateJob("item-seed-a", req, "/path");

        Assert.Equal(job1.Seed, job2.Seed);
    }

    // ── CancelJob ─────────────────────────────────────────────────────────────

    [Fact]
    public void CancelJob_ExistingJob_SetsCancelledStatus()
    {
        var req = new PosterSheetRequestDto { Rows = 2, Cols = 2 };
        var job = _svc.GetOrCreateJob("item-cancel", req, "/nonexistent");

        _svc.CancelJob(job.Id);

        Assert.Equal(JobStatus.Cancelled, job.Status);
        Assert.True(job.Cts.Token.IsCancellationRequested);
    }

    [Fact]
    public void CancelJob_UnknownId_DoesNotThrow()
    {
        var ex = Record.Exception(() => _svc.CancelJob("nonexistent-job-id"));
        Assert.Null(ex);
    }

    // ── GetJob ────────────────────────────────────────────────────────────────

    [Fact]
    public void GetJob_ExistingJobId_ReturnsJob()
    {
        var req = new PosterSheetRequestDto();
        var created = _svc.GetOrCreateJob("item-get", req, "/path");

        var found = _svc.GetJob(created.Id);

        Assert.NotNull(found);
        Assert.Equal(created.Id, found.Id);
    }

    [Fact]
    public void GetJob_UnknownId_ReturnsNull()
    {
        var result = _svc.GetJob("does-not-exist");
        Assert.Null(result);
    }

    // ── ComputeOverlayHash ───────────────────────────────────────────────────

    [Fact]
    public void ComputeOverlayHash_SameSettings_SameHash()
    {
        var a = new OverlaySettings { BrandingText = "Test", ColorTheme = "dark" };
        var b = new OverlaySettings { BrandingText = "Test", ColorTheme = "dark" };

        Assert.Equal(
            PosterSheetJobService.ComputeOverlayHash(a),
            PosterSheetJobService.ComputeOverlayHash(b));
    }

    [Fact]
    public void ComputeOverlayHash_DifferentSettings_DifferentHash()
    {
        var a = new OverlaySettings { ColorTheme = "dark" };
        var b = new OverlaySettings { ColorTheme = "light" };

        Assert.NotEqual(
            PosterSheetJobService.ComputeOverlayHash(a),
            PosterSheetJobService.ComputeOverlayHash(b));
    }

    [Fact]
    public void ComputeOverlayHash_ReturnsEightCharHex()
    {
        var hash = PosterSheetJobService.ComputeOverlayHash(new OverlaySettings());
        Assert.Equal(8, hash.Length);
        Assert.Matches("^[0-9a-f]{8}$", hash);
    }
}
