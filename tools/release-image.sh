#!/bin/bash

while getopts ":t:" o; do
    case "${o}" in
    t)
        t=${OPTARG}
        ;;
    *)
        usage
        ;;
    esac
done

shift $(($OPTIND - 1))

if [ "$#" -ne 1 ]; then
  echo "USAGE: $0 [-t tag] environment_name" >& 2
  echo "environment_name should correspond to directory environments/environment_name"
  exit 1
fi

if [ ! -d "environments/$1/" ]; then
  echo "ERR: environments/$1 does not exist" >& 2
  exit 2
fi

if [ ! -f "environments/$1/Dockerfile" ]; then
  echo "ERR: environments/$1/Dockerfile does not exist" >& 2
  exit 3
fi

if [ -z "${t}" ]; then
    while true; do
        read -p "No tag specified; using \"latest\" by default. Continue? (y/n): " yn
        case $yn in
            [Yy]* ) break;;
            [Nn]* ) exit;;
            * ) echo "Please answer yes or no. ";;
        esac
    done
    t="latest"
fi

cd environments/$1/
docker build -t prairielearn/$1 .

if [ $? -ne 0 ]; then
  echo "ERR: building image failed. skipping upload." >& 2
  exit 4
fi

docker tag prairielearn/$1 prairielearn/$1:${t}
docker push prairielearn/$1:${t}
