"""
Generate the Android and iOS app icons and splash screens from the pixel bunny (build/bunny.png).
Usage: python3 scripts/mobile_icons.py
"""
from pathlib import Path
import json
from PIL import Image, ImageDraw

ROOT = Path( __file__ ).resolve().parent.parent
RES = ROOT / 'mobile/android/app/src/main/res'
ASSETS = ROOT / 'mobile/ios/App/App/Assets.xcassets'
BACKGROUND = ( 0xFF, 0x8A, 0x57, 255 )   # brand orange behind the icon
SPLASH = ( 0xF7, 0xF6, 0xF2, 255 )       # paper, the light theme's page
SPLASH_DARK = ( 0x00, 0x2B, 0x36, 255 )  # deep blue, the dark theme's page
icon = Image.open( ROOT / 'build/bunny.png' ).convert( 'RGBA' )

DENSITIES = { 'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4 }


def on_background( size, scale, shape = None ):
    """The icon centred at `scale` of a `size` square on the app background"""
    canvas = Image.new( 'RGBA', ( size, size ), BACKGROUND if shape else ( 0, 0, 0, 0 ) )
    inner = round( size * scale )
    canvas.alpha_composite( icon.resize( ( inner, inner ), Image.LANCZOS ), ( ( size - inner ) // 2, ) * 2 )
    if shape:
        mask = Image.new( 'L', ( size, size ), 0 )
        draw = ImageDraw.Draw( mask )
        if shape == 'round': draw.ellipse( ( 0, 0, size - 1, size - 1 ), fill = 255 )
        else: draw.rounded_rectangle( ( 0, 0, size - 1, size - 1 ), radius = size // 6, fill = 255 )
        canvas.putalpha( mask )
    return canvas


for density, factor in DENSITIES.items():
    folder = RES / f'mipmap-{ density }'
    legacy = round( 48 * factor )
    on_background( legacy, 0.7, 'square' ).save( folder / 'ic_launcher.png' )
    on_background( legacy, 0.7, 'round' ).save( folder / 'ic_launcher_round.png' )
    # Adaptive foreground: 108dp canvas, the launcher mask keeps the middle 66dp
    on_background( round( 108 * factor ), 0.5 ).save( folder / 'ic_launcher_foreground.png' )

# iOS: one opaque 1024 icon (the system rounds the corners)
square = Image.new( 'RGBA', ( 1024, 1024 ), BACKGROUND )
square.alpha_composite( on_background( 1024, 0.7 ) )
square.convert( 'RGB' ).save( ASSETS / 'AppIcon.appiconset/AppIcon-512@2x.png' )

# Splash: the icon small and centred on the page colour, any orientation
def splash( path, colour, size = None ):
    width, height = size or Image.open( path ).size
    canvas = Image.new( 'RGBA', ( width, height ), colour )
    inner = min( width, height ) // 4
    canvas.alpha_composite( icon.resize( ( inner, inner ), Image.LANCZOS ), ( ( width - inner ) // 2, ( height - inner ) // 2 ) )
    canvas.convert( 'RGB' ).save( path )


for path in RES.glob( 'drawable*/splash.png' ):
    splash( path, SPLASH )

# iOS: one light and one dark image per scale, picked by the device appearance
SCALES = { '1x': '-2', '2x': '-1', '3x': '' }
images = []
for scale, suffix in SCALES.items():
    for dark in ( False, True ):
        name = f'splash{ "-dark" if dark else "" }-2732x2732{ suffix }.png'
        splash( ASSETS / 'Splash.imageset' / name, SPLASH_DARK if dark else SPLASH, ( 2732, 2732 ) )
        entry = { 'idiom': 'universal', 'filename': name, 'scale': scale }
        if dark: entry[ 'appearances' ] = [ { 'appearance': 'luminosity', 'value': 'dark' } ]
        images.append( entry )
( ASSETS / 'Splash.imageset/Contents.json' ).write_text( json.dumps( { 'images': images, 'info': { 'version': 1, 'author': 'xcode' } }, indent = 2 ) + '\n' )

( RES / 'values/ic_launcher_background.xml' ).write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#FF8A57</color>\n</resources>\n'
)
print( 'Icons and splash screens written to', RES, 'and', ASSETS )
