from PIL import Image, ImageDraw, ImageFont
import math, subprocess
from pathlib import Path
root = Path(__file__).resolve().parents[1]
w,h,fps,seconds=960,540,24,5
font_path='/System/Library/Fonts/Supplemental/Arial.ttf'
font=ImageFont.truetype(font_path,25)
small=ImageFont.truetype(font_path,11)
base=Image.new('RGB',(w,h))
p=base.load()
for y in range(h):
    t=y/h
    top=(24,56,64); bottom=(135,174,161)
    for x in range(w):
        p[x,y]=tuple(round(a+(b-a)*t) for a,b in zip(top,bottom))
proc=subprocess.Popen(['/opt/homebrew/bin/ffmpeg','-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{w}x{h}','-r',str(fps),'-i','pipe:0','-f','lavfi','-i','sine=frequency=220:sample_rate=48000','-t',str(seconds),'-vf','format=yuv420p','-c:v','libvpx-vp9','-b:v','0','-crf','31','-deadline','realtime','-cpu-used','5','-c:a','libopus','-af','volume=0.07',str(root/'dist/assets/sample.webm')],stdin=subprocess.PIPE)
for frame in range(fps*seconds):
    im=base.copy(); d=ImageDraw.Draw(im)
    t=frame/fps
    sy=218+3*math.sin(t*.6)
    d.ellipse((654,sy-58,770,sy+58),fill=(240,188,127))
    d.polygon([(0,380),(130,280),(240,310),(370,210),(510,320),(690,340),(960,300),(960,540),(0,540)],fill=(35,76,77))
    d.polygon([(0,380),(180,420),(360,365),(570,400),(730,360),(960,380),(960,540),(0,540)],fill=(25,55,59))
    for j in range(18):
        yy=402+j*8
        xx=580+int(45*math.sin(j*.7+t))
        length=22+j*7
        d.line((xx-length,yy,xx+length,yy),fill=(71+j*2,101+j*2,98+j*2),width=1)
    d.text((45,43),'A quiet moment.',font=font,fill=(240,244,233))
    d.text((46,82),'MAITAKE  /  SAMPLE FILM',font=small,fill=(149,177,175))
    d.rounded_rectangle((44,477,141,503),radius=13,fill=(48,78,77))
    d.text((58,485),'LOCAL SAMPLE',font=small,fill=(206,224,213))
    d.text((858,485),f'00:{int(t):02d}',font=small,fill=(192,212,206))
    proc.stdin.write(im.tobytes())
proc.stdin.close()
raise SystemExit(proc.wait())
