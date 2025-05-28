import uuid
from base64 import encodebytes
from io import BytesIO
import asyncio
import cv2
import numpy as np
from PIL import Image
import aioboto3
from botocore.exceptions import BotoCoreError, ClientError
import logging

Image.MAX_IMAGE_PIXELS = None
encode_param = [cv2.IMWRITE_PNG_COMPRESSION, 0]

class S3Utils:
    def __init__(self, bucket_name, access_key, secret_key, region_name, session_token=None) -> None:
        self.bucket_name = bucket_name
        self.access_key = access_key
        self.secret_key = secret_key
        self.region_name = region_name
        self.session_token = session_token
        # Create an aioboto3 session with credentials.
        self.session = aioboto3.Session(
            aws_access_key_id=self.access_key,
            aws_secret_access_key=self.secret_key,
            aws_session_token=self.session_token,
            region_name=self.region_name
        )

    async def read_image_from_s3(self, s3_path):
        logging.info(f"Start reading image from S3: {s3_path}")
        async with self.session.resource('s3') as s3:
            bucket = await s3.Bucket(self.bucket_name)
            s3_object = await bucket.Object(s3_path)
            response = await s3_object.get()
            file_stream = response['Body']
            data = await file_stream.read()  # Await the coroutine to get bytes
            im = Image.open(BytesIO(data))   # Wrap bytes in BytesIO for Image.open
        logging.info(f"Finished reading image from S3: {s3_path}")
        return im

    async def read_image_from_s3_cv2(self, s3_path):
        logging.info(f"Start reading image (cv2) from S3: {s3_path}")
        async with self.session.resource('s3') as s3:
            bucket = await s3.Bucket(self.bucket_name)
            s3_object = await bucket.Object(s3_path)
            response = await s3_object.get()
            data = await response['Body'].read()
            im_cv2 = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_UNCHANGED)
        logging.info(f"Finished reading image (cv2) from S3: {s3_path}")
        return im_cv2

    async def read_file_from_s3_path(self, s3_path, local_filename):
        logging.info(f"Start downloading file from S3: {s3_path} to local path: {local_filename}")
        async with self.session.client('s3') as s3_client:
            await s3_client.download_file(self.bucket_name, s3_path, local_filename)
        logging.info(f"Finished downloading file from S3: {s3_path} to local path: {local_filename}")
        return local_filename

    async def read_from_bucket_folder(self, folder):
        logging.info(f"Start reading files from bucket folder: {folder}")
        async with self.session.resource('s3') as s3:
            bucket = await s3.Bucket(self.bucket_name)
            results = []
            async for obj in bucket.objects.filter(Prefix=folder):
                results.append(obj.key)
            results = [item for item in results if not item.endswith('/')]
        logging.info(f"Finished reading files from bucket folder: {folder}")
        return results

    async def write_image_to_s3(self, im, upload_path):
        logging.info(f"Start writing image to S3: {upload_path}")
        async with self.session.resource('s3') as s3:
            bucket = await s3.Bucket(self.bucket_name)
            s3_object = await bucket.Object(upload_path)
            file_stream = BytesIO()
            im.save(file_stream, format='png')
            await s3_object.put(Body=file_stream.getvalue(), ContentType="image/png")
        logging.info(f"Finished writing image to S3: {upload_path}")

    async def write_cv2_image_to_s3(self, im, upload_path):
        logging.info(f"Start writing cv2 image to S3: {upload_path}")
        async with self.session.resource('s3') as s3:
            bucket = await s3.Bucket(self.bucket_name)
            s3_object = await bucket.Object(upload_path)
            is_success, im_bytes = cv2.imencode(ext=".png", img=im, params=encode_param)
            if not is_success:
                raise Exception("Failed to encode image")
            await s3_object.put(Body=im_bytes.tobytes(), ContentType="image/png")
        logging.info(f"Finished writing cv2 image to S3: {upload_path}")
        return upload_path

    async def write_filestream_to_s3(self, filestream, upload_path):
        logging.info(f"Start writing filestream to S3: {upload_path}")
        async with self.session.resource('s3') as s3:
            bucket = await s3.Bucket(self.bucket_name)
            s3_object = await bucket.Object(upload_path)
            await s3_object.put(Body=filestream.getvalue())
        logging.info(f"Finished writing filestream to S3: {upload_path}")
        return upload_path

    async def write_file_to_s3(self, local_file_path, s3_file_path_with_extension):
        logging.info(f"Start uploading local file {local_file_path} to S3: {s3_file_path_with_extension}")
        async with self.session.client('s3') as s3_client:
            await s3_client.upload_file(local_file_path, self.bucket_name, s3_file_path_with_extension)
        logging.info(f"Finished uploading local file {local_file_path} to S3: {s3_file_path_with_extension}")

    async def parallel_process(self, function, iterable):
        logging.info("Start parallel processing")
        tasks = [function(item) for item in iterable]
        await asyncio.gather(*tasks)
        logging.info("Finished parallel processing")

    async def copy_file_uuid(self, source_path):
        logging.info(f"Start copying file with UUID for: {source_path}")
        try:
            parts = source_path.split('/')
            if len(parts) < 3:
                raise ValueError("Source path must be in the format 'folder/uuid/...'.")
            new_uuid = str(uuid.uuid4())
            parts[1] = new_uuid
            new_path = '/'.join(parts)
            s3_root_path = '/'.join(parts[:2])
            copy_source = {'Bucket': self.bucket_name, 'Key': source_path}
            async with self.session.client('s3') as s3_client:
                await s3_client.copy(copy_source, self.bucket_name, new_path)
            logging.info(f"Finished copying file. New path: {new_path}, S3 root path: {s3_root_path}")
            return new_path, s3_root_path
        except (BotoCoreError, ClientError) as e:
            logging.error(f"An error occurred while copying the file: {e}")
            raise
        except Exception as e:
            logging.error(f"An unexpected error occurred: {e}")
            raise

    async def copy_s3_object(self, source_key: str, destination_key: str):
        logging.info(f"Starting S3 server-side copy from '{source_key}' to '{destination_key}' in bucket '{self.bucket_name}'")
        try:
            copy_source = {'Bucket': self.bucket_name, 'Key': source_key}
            async with self.session.client('s3') as s3_client:
                await s3_client.copy(copy_source, self.bucket_name, destination_key)
            logging.info(f"Successfully copied S3 object from '{source_key}' to '{destination_key}'")
            return destination_key
        except (BotoCoreError, ClientError) as e:
            logging.error(f"S3 copy error from '{source_key}' to '{destination_key}': {e}")
            raise
        except Exception as e:
            logging.error(f"Unexpected error during S3 copy from '{source_key}' to '{destination_key}': {e}")
            raise