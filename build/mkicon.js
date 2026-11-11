const { app, BrowserWindow } = require('electron');
app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false });
  await w.loadURL('data:text/html,<canvas id=c width=1024 height=1024></canvas>');
  const url = await w.webContents.executeJavaScript(`(()=>{const c=document.getElementById('c'),x=c.getContext('2d'),S=1024,C=512;
  x.fillStyle='#080a14';x.beginPath();x.roundRect(80,80,864,864,190);x.fill();
  const g=x.createRadialGradient(C,C,10,C,C,520);g.addColorStop(0,'#1a1f3d');g.addColorStop(1,'#080a14');x.fillStyle=g;x.beginPath();x.roundRect(80,80,864,864,190);x.fill();
  const cols=['#a78bfa','#2dd4bf','#ff6fae','#fbbf24','#a78bfa','#2dd4bf'];
  x.globalCompositeOperation='lighter';
  cols.forEach((col,i)=>{const a=i*Math.PI/3-Math.PI/2,px=C+270*Math.cos(a),py=C+270*Math.sin(a);
    x.shadowColor=col;x.shadowBlur=40;x.strokeStyle=col;x.lineWidth=12;x.beginPath();x.moveTo(px,py);x.quadraticCurveTo(C+120*Math.cos(a+.6),C+120*Math.sin(a+.6),C,C);x.stroke();
    const rg=x.createRadialGradient(px-15,py-15,4,px,py,62);rg.addColorStop(0,'#fff');rg.addColorStop(.4,col);rg.addColorStop(1,col+'55');x.fillStyle=rg;x.beginPath();x.arc(px,py,58,0,7);x.fill();});
  x.shadowColor='#c7d2fe';x.shadowBlur=80;const cg=x.createRadialGradient(C-30,C-30,8,C,C,115);cg.addColorStop(0,'#fff');cg.addColorStop(.35,'#c7d2fe');cg.addColorStop(1,'#4f46e5');x.fillStyle=cg;x.beginPath();x.arc(C,C,110,0,7);x.fill();
  return c.toDataURL('image/png');})()`);
  require('fs').writeFileSync(__dirname + '/icon.png', Buffer.from(url.split(',')[1], 'base64'));
  app.quit();
});
