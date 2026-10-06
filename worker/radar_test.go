package main

import "testing"

func TestParseOverview(t *testing.T) {
	mirage := `"de_mirage"
{
	"material"	"overviews/de_mirage"	// texture file
	"pos_x"		"-3230"	// X coordinate,
	"pos_y"		"1713"
	"scale"		"5.00" 	// and used scale
}`
	r := ParseOverview("de_mirage", mirage)
	if len(r) != 1 || r[0].PosX != -3230 || r[0].PosY != 1713 || r[0].Scale != 5 || r[0].Level != "default" {
		t.Fatalf("mirage: %+v", r)
	}
	nuke := `"de_nuke"
{
	"pos_x"		"-3453"
	"pos_y"		"2887"
	"scale"		"7"
	"verticalsections"
	{
		"default" // use the primary radar image
		{
			"AltitudeMax" "10000"
			"AltitudeMin" "-495"
		}
		"lower" // i.e. de_nuke_lower_radar.dds
		{
			"AltitudeMax" "-495"
			"AltitudeMin" "-10000"
		}
	}
}`
	r = ParseOverview("de_nuke", nuke)
	if len(r) != 2 || r[1].Level != "lower" || *r[1].AltitudeMax != -495 || *r[0].AltitudeMin != -495 {
		t.Fatalf("nuke: %+v", r)
	}
	if radarTexture("de_nuke", "lower") != "panorama/images/overheadmaps/de_nuke_lower_radar_psd.vtex_c" {
		t.Fatal("texture path")
	}
}
