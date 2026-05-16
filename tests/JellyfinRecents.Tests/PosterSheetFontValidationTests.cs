using System.Text;
using Jellyfin.Plugin.JellyfinRecents.Controllers;
using Xunit;

namespace JellyfinRecents.Tests;

public class PosterSheetFontValidationTests
{
    // ---------------------------------------------------------------------------
    // HasValidFontMagic
    // ---------------------------------------------------------------------------

    [Theory]
    [InlineData(new byte[] { 0x00, 0x01, 0x00, 0x00 })]  // TrueType 1.0
    [InlineData(new byte[] { 0x74, 0x72, 0x75, 0x65 })]  // 'true' Mac TrueType
    [InlineData(new byte[] { 0x4F, 0x54, 0x54, 0x4F })]  // 'OTTO' OpenType/CFF
    [InlineData(new byte[] { 0x77, 0x4F, 0x46, 0x46 })]  // 'wOFF' WOFF1
    [InlineData(new byte[] { 0x77, 0x4F, 0x46, 0x32 })]  // 'wOF2' WOFF2
    public void HasValidFontMagic_ValidHeaders_ReturnsTrue(byte[] magic)
    {
        var data = new byte[64];
        Array.Copy(magic, data, 4);
        Assert.True(PosterSheetController.HasValidFontMagic(data));
    }

    [Theory]
    [InlineData(new byte[] { 0x74, 0x74, 0x63, 0x66 })]  // 'ttcf' TTC — intentionally excluded
    [InlineData(new byte[] { 0x25, 0x50, 0x44, 0x46 })]  // '%PDF'
    [InlineData(new byte[] { 0x50, 0x4B, 0x03, 0x04 })]  // PK (zip)
    [InlineData(new byte[] { 0x00, 0x00, 0x00, 0x00 })]  // all-zero
    public void HasValidFontMagic_InvalidHeaders_ReturnsFalse(byte[] magic)
    {
        var data = new byte[64];
        Array.Copy(magic, data, 4);
        Assert.False(PosterSheetController.HasValidFontMagic(data));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(3)]
    public void HasValidFontMagic_TooShort_ReturnsFalse(int len)
    {
        Assert.False(PosterSheetController.HasValidFontMagic(new byte[len]));
    }

    // ---------------------------------------------------------------------------
    // SanitizeFontName
    // ---------------------------------------------------------------------------

    [Theory]
    [InlineData("Roboto", "Roboto")]
    [InlineData("Roboto Mono", "Roboto-Mono")]
    [InlineData("Playfair Display", "Playfair-Display")]
    [InlineData("Inter (Bold)", "Inter-Bold")]
    [InlineData("A   B", "A-B")]                          // consecutive spaces collapse
    [InlineData(" Leading Space", "Leading-Space")]        // leading space stripped
    [InlineData("Trailing ", "Trailing")]                  // trailing hyphen trimmed
    [InlineData("Noto Sans CJK JP", "Noto-Sans-CJK-JP")]
    public void SanitizeFontName_TypicalNames_ProducesExpected(string input, string expected)
    {
        Assert.Equal(expected, PosterSheetController.SanitizeFontName(input));
    }

    [Fact]
    public void SanitizeFontName_AllSpecialChars_ReturnsEmpty()
    {
        Assert.Equal(string.Empty, PosterSheetController.SanitizeFontName("!@#$%^&*"));
    }

    [Fact]
    public void SanitizeFontName_LongName_TruncatesAt64()
    {
        var name = new string('A', 70);
        var result = PosterSheetController.SanitizeFontName(name);
        Assert.Equal(64, result.Length);
        Assert.Equal(new string('A', 64), result);
    }

    // ---------------------------------------------------------------------------
    // ReadFontFamilyName — helpers
    // ---------------------------------------------------------------------------

    private static byte[] FontWithRecords(params (ushort nameId, ushort platformId, ushort encodingId, string text)[] records)
    {
        var encodedNames = records.Select(r => Encoding.BigEndianUnicode.GetBytes(r.text)).ToArray();
        var count = (ushort)records.Length;
        var strStorageOffset = (ushort)(6 + count * 12);
        var nameTableSize = 6 + count * 12 + encodedNames.Sum(b => b.Length);
        const uint nameTableOffset = 28; // 12-byte font header + 16-byte table dir

        var result = new List<byte>();
        void W16(ushort v) { result.Add((byte)(v >> 8)); result.Add((byte)(v & 0xFF)); }
        void W32(uint v) { result.Add((byte)(v >> 24)); result.Add((byte)((v >> 16) & 0xFF)); result.Add((byte)((v >> 8) & 0xFF)); result.Add((byte)(v & 0xFF)); }

        // Font header (12 bytes): TrueType sfVersion
        result.AddRange(new byte[] { 0x00, 0x01, 0x00, 0x00 });
        W16(1); W16(0); W16(0); W16(0); // numTables=1, padding

        // Table directory entry for "name" (16 bytes)
        result.AddRange(Encoding.ASCII.GetBytes("name"));
        W32(0);                         // checksum (unused)
        W32(nameTableOffset);           // offset
        W32((uint)nameTableSize);       // length

        // Name table header (6 bytes)
        W16(0);               // format = 0
        W16(count);           // count
        W16(strStorageOffset); // string storage offset from name table start

        // Name records (12 bytes each)
        ushort strOff = 0;
        for (int i = 0; i < records.Length; i++)
        {
            W16(records[i].platformId);
            W16(records[i].encodingId);
            W16(0x0409); // en-US
            W16(records[i].nameId);
            W16((ushort)encodedNames[i].Length);
            W16(strOff);
            strOff += (ushort)encodedNames[i].Length;
        }

        // String storage
        foreach (var b in encodedNames)
            result.AddRange(b);

        return result.ToArray();
    }

    private static byte[] MinimalFont(string familyName, ushort nameId = 1, ushort platformId = 3, ushort encodingId = 1)
        => FontWithRecords((nameId, platformId, encodingId, familyName));

    // ---------------------------------------------------------------------------
    // ReadFontFamilyName — tests
    // ---------------------------------------------------------------------------

    [Fact]
    public void ReadFontFamilyName_NameId1_ReturnsFamily()
    {
        var data = MinimalFont("Roboto", nameId: 1);
        Assert.Equal("Roboto", PosterSheetController.ReadFontFamilyName(data));
    }

    [Fact]
    public void ReadFontFamilyName_NameId16_ReturnsPreferredFamily()
    {
        var data = MinimalFont("Roboto Condensed", nameId: 16);
        Assert.Equal("Roboto Condensed", PosterSheetController.ReadFontFamilyName(data));
    }

    [Fact]
    public void ReadFontFamilyName_NameId4_ReturnsFullName()
    {
        var data = MinimalFont("Roboto Bold Italic", nameId: 4);
        Assert.Equal("Roboto Bold Italic", PosterSheetController.ReadFontFamilyName(data));
    }

    [Fact]
    public void ReadFontFamilyName_PreferredFamilyOverFamily()
    {
        // nameId=16 should win over nameId=1
        var data = FontWithRecords(
            (1, 3, 1, "Roboto"),
            (16, 3, 1, "Roboto Preferred"));
        Assert.Equal("Roboto Preferred", PosterSheetController.ReadFontFamilyName(data));
    }

    [Fact]
    public void ReadFontFamilyName_FamilyOverFullName()
    {
        // nameId=1 should win over nameId=4
        var data = FontWithRecords(
            (4, 3, 1, "Roboto Bold"),
            (1, 3, 1, "Roboto"));
        Assert.Equal("Roboto", PosterSheetController.ReadFontFamilyName(data));
    }

    [Fact]
    public void ReadFontFamilyName_NonWindowsPlatform_Ignored()
    {
        // platform=0 (Mac) should be ignored; no Windows record → null
        var data = MinimalFont("Roboto", nameId: 1, platformId: 0, encodingId: 0);
        Assert.Null(PosterSheetController.ReadFontFamilyName(data));
    }

    [Fact]
    public void ReadFontFamilyName_CorruptData_ReturnsNull()
    {
        Assert.Null(PosterSheetController.ReadFontFamilyName(new byte[] { 0x00, 0x01, 0x02, 0x03 }));
    }

    [Fact]
    public void ReadFontFamilyName_EmptyData_ReturnsNull()
    {
        Assert.Null(PosterSheetController.ReadFontFamilyName(Array.Empty<byte>()));
    }

    [Fact]
    public void ReadFontFamilyName_NonAsciiName_RoundTrips()
    {
        var name = "日本語フォント";
        var data = MinimalFont(name, nameId: 1);
        Assert.Equal(name, PosterSheetController.ReadFontFamilyName(data));
    }
}
