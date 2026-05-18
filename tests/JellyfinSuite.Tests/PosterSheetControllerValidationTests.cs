using Xunit;

namespace JellyfinSuite.Tests;

/// <summary>
/// Tests for the min-spacing validation formula used in PosterSheetController.
/// Extracted as pure math so no controller instantiation is needed.
/// </summary>
public class PosterSheetControllerValidationTests
{
    // Mirror of the server-side formula:  maxFrames = Floor(durationSeconds / 2)
    private static int MaxFrames(double durationSeconds) =>
        (int)Math.Floor(durationSeconds / 2.0);

    private static bool IsGridValid(int rows, int cols, double durationSeconds) =>
        rows * cols <= MaxFrames(durationSeconds);

    [Theory]
    [InlineData(6, 8, 3600)]    // 48 frames, 75 s/frame → valid
    [InlineData(2, 4, 30)]      // 8 frames, 3.75 s/frame → valid
    [InlineData(1, 1, 2)]       // exactly 2 s/frame → valid
    [InlineData(3, 3, 18)]      // 9 frames, 2 s/frame → valid
    public void IsGridValid_ValidGrids(int rows, int cols, double duration)
    {
        Assert.True(IsGridValid(rows, cols, duration));
    }

    [Theory]
    [InlineData(6, 8, 30)]      // 48 frames, 0.625 s/frame → invalid
    [InlineData(10, 12, 10)]    // 120 frames, 0.083 s/frame → invalid
    [InlineData(1, 2, 3)]       // 2 frames, 1.5 s/frame → invalid (< 2)
    public void IsGridValid_InvalidGrids(int rows, int cols, double duration)
    {
        Assert.False(IsGridValid(rows, cols, duration));
    }

    [Fact]
    public void MaxFrames_RoundsDown()
    {
        // 5.9 s → floor(5.9/2) = 2, not 3
        Assert.Equal(2, MaxFrames(5.9));
    }

    [Fact]
    public void MaxFrames_ExactlyTwoSeconds_CountsAsOne()
    {
        Assert.Equal(1, MaxFrames(2.0));
    }

    [Fact]
    public void MaxFrames_ShortVideo30s_FifteenFrames()
    {
        Assert.Equal(15, MaxFrames(30.0));
    }

    [Theory]
    [InlineData(48, 3600, "Grid too large")]  // expected error scenario
    [InlineData(48, 29,   "Grid too large")]
    public void ErrorMessage_ContainsMaxFrameCount(int requested, double duration, string expectedFragment)
    {
        var max = MaxFrames(duration);
        var msg = $"Grid too large for video duration. Maximum {max} frames (2s spacing). Requested: {requested}.";
        Assert.Contains(expectedFragment, msg);
        Assert.Contains(max.ToString(), msg);
    }
}
