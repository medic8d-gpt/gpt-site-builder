const express=require("express");
const bodyParser=require("body-parser");
const fs=require("fs");
const path=require("path");
const app=express();
app.use(bodyParser.json());
app.use(express.static("public"));
app.get("/",(req,res)=>{res.sendFile(path.join(__dirname,"public/index.html"));});
app.post("/update-site",(req,res)=>{
  const {filename,content}=req.body;
  if(!filename||!content) return res.status(400).json({error:"filename and content required"});
  fs.writeFile(path.join(__dirname,"public",filename),content,(e)=>{
    if(e) return res.status(500).json({error:"write failed"});
    res.json({success:true,file:filename});
  });
});
app.listen(process.env.PORT||3000);