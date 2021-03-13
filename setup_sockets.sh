ln -s /lib/libc.musl-x86_64.so.1 /lib/ld-linux-x86-64.so.2

echo 'net.ipv4.ip_local_port_range = 12000 65535' >> /etc/sysctl.conf
echo 'fs.file-max = 1048576' >> /etc/sysctl.conf
mkdir /etc/security/
echo '*                soft    nofile          1048576' >> /etc/security/limits.conf
echo '*                hard    nofile          1048576' >> /etc/security/limits.conf
echo 'root             soft    nofile          1048576' >> /etc/security/limits.conf
echo 'root             hard    nofile          1048576' >> /etc/security/limits.conf