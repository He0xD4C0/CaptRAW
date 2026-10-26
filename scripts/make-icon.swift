import AppKit
let size=1024
let image=NSImage(size:NSSize(width:size,height:size))
image.lockFocus()
NSColor(calibratedRed:0.12,green:0.14,blue:0.16,alpha:1).setFill()
NSBezierPath(roundedRect:NSRect(x:0,y:0,width:size,height:size),xRadius:220,yRadius:220).fill()
let center=NSPoint(x:512,y:512),radius:CGFloat=310
NSColor(calibratedRed:0.79,green:0.86,blue:0.94,alpha:1).setStroke()
let ring=NSBezierPath(ovalIn:NSRect(x:202,y:202,width:620,height:620));ring.lineWidth=20;ring.stroke()
for i in 0..<6 {
 let angle=CGFloat(i)*CGFloat.pi/3
 func point(_ r:CGFloat,_ a:CGFloat)->NSPoint {NSPoint(x:center.x+r*cos(a),y:center.y+r*sin(a))}
 let line=NSBezierPath();line.move(to:point(radius,angle));line.line(to:point(radius*0.43,angle+CGFloat.pi*0.46));line.lineWidth=19;line.lineCapStyle = .round;line.stroke()
}
image.unlockFocus()
let rep=NSBitmapImageRep(data:image.tiffRepresentation!)!
try rep.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:CommandLine.arguments[1]))
