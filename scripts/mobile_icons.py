"""
Generate the Android and iOS app icons and splash screens from the pixel bunny (build/bunny.png).
Usage: python3 scripts/mobile_icons.py
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path( __file__ ).resolve().parent.parent
RES = ROOT / 'mobile/android/app/src/main/res'
ASSETS = ROOT / 'mobile/ios/App/App/Assets.xcassets'
BACKGROUND = ( 0xFF, 0x8A, 0x57, 255 )   # brand orange behind the icon
SPLASH = ( 0xF7, 0xF6, 0xF2, 255 )       # paper, the light theme's page
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

# Splash: the icon small and centred on the app background, any orientation
for splash in [ *RES.glob( 'drawable*/splash.png' ), *ASSETS.glob( 'Splash.imageset/*.png' ) ]:
    width, height = Image.open( splash ).size
    canvas = Image.new( 'RGBA', ( width, height ), SPLASH )
    inner = min( width, height ) // 4
    canvas.alpha_composite( icon.resize( ( inner, inner ), Image.LANCZOS ), ( ( width - inner ) // 2, ( height - inner ) // 2 ) )
    canvas.convert( 'RGB' ).save( splash )

( RES / 'values/ic_launcher_background.xml' ).write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#FF8A57</color>\n</resources>\n'
)
print( 'Icons and splash screens written to', RES, 'and', ASSETS )
