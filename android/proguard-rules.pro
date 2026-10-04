# R8 规则：Activity 由系统通过清单反射创建，必须保留
-keep class com.selfwriting.app.MainActivity { *; }
-keepclassmembers class com.selfwriting.app.LocalServer { *; }
-dontwarn android.**
-dontwarn java.**
-dontwarn javax.**
