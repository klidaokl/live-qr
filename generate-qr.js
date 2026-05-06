#!/usr/bin/env node
/**
 * 康比特活码生成工具
 * 用法：node generate-qr.js <京东商品链接> [活码名称]
 *
 * 示例：
 *   node generate-qr.js https://item.jd.com/100012345.html "5月蛋白粉主推"
 *
 * 会在当前目录生成：<活码名称>.png
 */

const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);

if (args.length < 1) {
  console.log('用法：node generate-qr.js <URL> [名称]');
  console.log('示例：node generate-qr.js https://item.jd.com/100012345.html "5月蛋白粉"');
  process.exit(1);
}

const url = args[0];
const name = args[1] || 'qrcode';

if (!url.startsWith('http')) {
  console.log('错误：请输入有效的URL（以http开头）');
  process.exit(1);
}

const outputPath = path.join(process.cwd(), `${name}.png`);

QRCode.toFile(outputPath, url, {
  width: 800,
  margin: 2,
  errorCorrectionLevel: 'H'
}, function(err) {
  if (err) { console.error('生成失败:', err.message); process.exit(1); }
  console.log('✅ 二维码已生成');
  console.log('📁 文件:', outputPath);
  console.log('🔗 跳转:', url);
  console.log('');
  console.log('💡 提示：此二维码为静态码，URL固定在码中无法修改');
  console.log('   如需动态修改跳转目标，请使用活码系统后台');
});
