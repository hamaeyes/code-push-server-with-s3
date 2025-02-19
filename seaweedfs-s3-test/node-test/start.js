import { S3Client, PutObjectCommand, ListObjectsCommand, CreateBucketCommand } from "@aws-sdk/client-s3";


// SeaweedFS S3 설정
const s3Client = new S3Client({
  region: "us-east-1",  // AWS S3처럼 설정 (SeaweedFS는 이 값을 무시)
  endpoint: "http://localhost:8333",  // SeaweedFS S3 API 엔드포인트
  forcePathStyle: true,  // 필수 (SeaweedFS는 virtual-hosted-style을 지원하지 않음)
  credentials: {
    accessKeyId: "some_access_key1",
    secretAccessKey: "some_secret_key1",
  },
});

async function createBucket(bucketName) {
  try {
    const command = new CreateBucketCommand({ Bucket: bucketName });
    const response = await s3Client.send(command);
    console.log("✅ Bucket Created Successfully:", response);
  } catch (error) {
    console.error("❌ Error Creating Bucket:", error);
  }
}

// 파일 업로드 예제
async function uploadFile() {
  const command = new PutObjectCommand({
    Bucket: "my-bucket",  // SeaweedFS에서 생성한 버킷
    Key: "test.txt",
    Body: "Hello, SeaweedFS!",
  });

  try {
    const response = await s3Client.send(command);
    console.log("File uploaded successfully:", response);
  } catch (err) {
    console.error("Upload error:", err);
  }
}

await createBucket('my-bucket1');

// 업로드 실행
uploadFile();

